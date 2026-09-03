const BigQueryValidator = {
  PROJECT_ID: 'h-apivp-0001-p',

  sqlString: function(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  },

  bqValue: function(row, index) {
    return (row.f[index] && row.f[index].v != null) ? String(row.f[index].v).trim() : "";
  },

  flagInvalidItems: function(parsedItems) {
    if (!parsedItems || parsedItems.length === 0) {
      return { hasInvalid: false, invalidItems: [], clientError: null };
    }

    let hasInvalid = false;
    let invalidItemsList = [];
    let clientErrorMessage = null;

    // Defaults so every item carries all sheet fields even if a check aborts early
    parsedItems.forEach(item => {
      item.existsInBq = false;
      item.marketMatch = "NOT MATCH";
      item.gboStatus = "NOT GBO";
      item.gboCheck = "NOT_CHECKED";
      item.resolvedCustomerNumber = "";
    });

    const uniqueItems = [...new Set(parsedItems.map(item => item.ITEM_NAME))];
    const inputItems = uniqueItems.map(name => `'${name}'`).join(',');

    // 1. MATERIAL VALIDATION
    const materialSql = `
      SELECT DISTINCT Item, Additional_code, Item_market
      FROM \`h-apivp-0001-p.SAP.Webshop_robot_item_t\`
      WHERE Item IN (${inputItems})
    `;

    let materialResults;
    try {
      materialResults = BigQuery.Jobs.query({ query: materialSql, useLegacySql: false }, this.PROJECT_ID);
    } catch (error) {
      throw new Error(`BigQuery connection failed for materials: ${error.message}`);
    }

    const validMaterialData = {};
    if (materialResults.rows) {
      materialResults.rows.forEach(row => {
        const itemName = this.bqValue(row, 0);
        const addCode = this.bqValue(row, 1);
        const itemMarket = this.bqValue(row, 2);

        if (!itemName) return;

        if (!validMaterialData[itemName]) {
          validMaterialData[itemName] = { addCode: "", markets: [] };
        }
        if (addCode) {
          validMaterialData[itemName].addCode = addCode;
        }
        if (itemMarket && validMaterialData[itemName].markets.indexOf(itemMarket) === -1) {
          validMaterialData[itemName].markets.push(itemMarket);
        }
      });
    }
    const validMaterials = Object.keys(validMaterialData);

    parsedItems.forEach(item => {
      item.existsInBq = validMaterials.includes(item.ITEM_NAME);
      if (item.existsInBq) {
        item.isValid = true;
      } else {
        item.isValid = false;
        hasInvalid = true;
        invalidItemsList.push(item.ITEM_NAME);
      }
    });

    // 2. CLIENT VALIDATION
    const customerNumber = parsedItems[0].CUSTOMER_NUMBER;
    const customerNameFromFile = String(parsedItems[0].CUSTOMER_NAME || "").trim();
    const safeCustomerName = this.sqlString(customerNameFromFile);
    const safeCustomerNumber = this.sqlString(customerNumber);

    if (!customerNumber || String(customerNumber).trim() === "" || customerNumber === "N/A") {
      hasInvalid = true;
      clientErrorMessage = "MISSING_ID";
    } else {
      const clientSql = `
        SELECT DISTINCT
          LTRIM(Customer_number, "C_0000") as Customer_Nr,
          Customer_user_name as Customer
        FROM \`h-apivp-0001-p.SAP.Webshop_robot_cust_t\`
        WHERE LTRIM(Customer_number, "C_0000") = '${safeCustomerNumber}'
      `;

      let clientResults;
      try {
        clientResults = BigQuery.Jobs.query({ query: clientSql, useLegacySql: false }, this.PROJECT_ID);
      } catch (error) {
        throw new Error(`BigQuery connection failed for client check: ${error.message}`);
      }

      let nameMatched = false;

      if (!clientResults.rows || clientResults.rows.length === 0) {
        hasInvalid = true;
        clientErrorMessage = "CLIENT_NOT_FOUND";
      } else {
        for (let r = 0; r < clientResults.rows.length; r++) {
          const dbCustomerName = this.bqValue(clientResults.rows[r], 1);

          if (dbCustomerName.toLowerCase() === customerNameFromFile.toLowerCase()) {
            nameMatched = true;
            break;
          }
        }

        if (!nameMatched) {
          hasInvalid = true;
          clientErrorMessage = `WRONG_NAME: The name '${customerNameFromFile}' is not associated with this Client ID.`;
        }
      }
    }

    // 3. WEBSHOP MARKET MATCH VALIDATION
    if (!clientErrorMessage) {
      const marketSql = `
        SELECT DISTINCT i.Item
        FROM \`h-apivp-0001-p.SAP.Webshop_robot_cust_t\` AS c
        INNER JOIN \`h-apivp-0001-p.SAP.Webshop_robot_item_t\` AS i
          ON c.Customer_webshop_market = i.Item_market
        WHERE LTRIM(c.Customer_number, "C_0000") = '${safeCustomerNumber}'
          AND i.Item IN (${inputItems})
      `;

      let marketResults;
      try {
        marketResults = BigQuery.Jobs.query({ query: marketSql, useLegacySql: false }, this.PROJECT_ID);
      } catch (error) {
        throw new Error(`BigQuery connection failed for market check: ${error.message}`);
      }

      const validMarketItems = [];
      if (marketResults.rows) {
        marketResults.rows.forEach(row => {
          const itemName = this.bqValue(row, 0);
          if (itemName) {
            validMarketItems.push(itemName);
          }
        });
      }

      const itemsFailingMarket = parsedItems.filter(item =>
        validMaterials.includes(item.ITEM_NAME) && !validMarketItems.includes(item.ITEM_NAME)
      );

      let gboCustomerCheck = { eligible: false, reason: "NOT_CHECKED", additionalCustomerNumber: "" };
      if (itemsFailingMarket.length > 0) {
        gboCustomerCheck = this.checkGboCustomerFallback(safeCustomerName, safeCustomerNumber);
      }

      const originalCustomerNumber = String(customerNumber || "").trim();

      parsedItems.forEach(item => {
        const materialInfo = validMaterialData[item.ITEM_NAME] || { addCode: "", markets: [] };
        const addCode = materialInfo.addCode || "";
        const isMaterialValid = validMaterials.includes(item.ITEM_NAME);
        const isMarketValid = validMarketItems.includes(item.ITEM_NAME);
        const isGboItem = addCode !== "";
        const itemHasGbm1 = materialInfo.markets.indexOf("GBM1") !== -1;

        item.marketMatch = isMarketValid ? "MATCH" : "NOT MATCH";
        item.gboStatus = isGboItem ? "GBO" : "NOT GBO";
        item.resolvedCustomerNumber = "";

        if (isMaterialValid && isMarketValid) {
          item.isValid = true;
          item.gboCheck = "STANDARD_MATCH";
          item.resolvedCustomerNumber = originalCustomerNumber;
          return;
        }

        if (isMaterialValid && !isMarketValid) {
          if (!isGboItem) {
            item.isValid = false;
            item.gboCheck = "NOT_GBO";
            return;
          }

          if (!gboCustomerCheck.eligible) {
            item.isValid = false;
            item.gboCheck = `GBO_FAIL:${gboCustomerCheck.reason}`;
            return;
          }

          if (!itemHasGbm1) {
            item.isValid = false;
            item.gboCheck = "GBO_FAIL:ITEM_MARKET_NOT_GBM1";
            return;
          }

          item.isValid = true;
          item.gboCheck = "GBO_MATCH";
          item.resolvedCustomerNumber = gboCustomerCheck.additionalCustomerNumber || "";
          return;
        }

        item.isValid = false;
        item.gboCheck = "MATERIAL_INVALID";
      });

    } else {
      parsedItems.forEach(item => {
        const materialInfo = validMaterialData[item.ITEM_NAME] || { addCode: "", markets: [] };
        const addCode = materialInfo.addCode || "";

        item.marketMatch = "NOT MATCH";
        item.gboStatus = (addCode !== "") ? "GBO" : "NOT GBO";
        item.gboCheck = "CLIENT_ERROR";
        item.isValid = false;
        hasInvalid = true;
        invalidItemsList.push(item.ITEM_NAME);
      });
    }

    invalidItemsList = parsedItems.filter(item => !item.isValid).map(item => item.ITEM_NAME);
    hasInvalid = invalidItemsList.length > 0;

    return {
      hasInvalid: hasInvalid,
      invalidItems: [...new Set(invalidItemsList)],
      clientError: clientErrorMessage
    };
  },

  checkGboCustomerFallback: function(safeCustomerName, safeCustomerNumber) {
    const gboSql = `
      SELECT DISTINCT
        LTRIM(Customer_number, "C_0000") AS Customer_number,
        Customer_Account_Group,
        Customer_VAT_ID_d,
        Customer_webshop_market
      FROM \`h-apivp-0001-p.SAP.Webshop_robot_cust_t\`
      WHERE LOWER(TRIM(Customer_name)) = LOWER('${safeCustomerName}')
    `;

    let gboResults;
    try {
      gboResults = BigQuery.Jobs.query({ query: gboSql, useLegacySql: false }, this.PROJECT_ID);
    } catch (error) {
      throw new Error(`BigQuery connection failed for GBO customer check: ${error.message}`);
    }

    if (!gboResults.rows || gboResults.rows.length === 0) {
      return { eligible: false, reason: "NO_CUSTOMER_NAME_MATCH", additionalCustomerNumber: "" };
    }

    const customers = gboResults.rows.map(row => ({
      number: this.bqValue(row, 0),
      group: this.bqValue(row, 1),
      vat: this.bqValue(row, 2),
      market: this.bqValue(row, 3)
    }));

    const uniqueNumbers = [];
    customers.forEach(customer => {
      if (customer.number && uniqueNumbers.indexOf(customer.number) === -1) {
        uniqueNumbers.push(customer.number);
      }
    });

    if (uniqueNumbers.length <= 1) {
      return { eligible: false, reason: "SINGLE_CUSTOMER_NUMBER", additionalCustomerNumber: "" };
    }

    const current = customers.filter(customer => customer.number === safeCustomerNumber);
    if (current.length === 0) {
      return { eligible: false, reason: "CURRENT_NUMBER_NOT_UNDER_NAME", additionalCustomerNumber: "" };
    }

    const currentVat = current[0].vat;
    const currentGroup = current[0].group;
    if (!currentVat || !currentGroup) {
      return { eligible: false, reason: "MISSING_VAT_OR_ACCOUNT_GROUP", additionalCustomerNumber: "" };
    }

    const otherSameVatGroup = customers.filter(customer =>
      customer.number !== safeCustomerNumber &&
      customer.vat === currentVat &&
      customer.group === currentGroup
    );

    if (otherSameVatGroup.length === 0) {
      return { eligible: false, reason: "NO_SAME_VAT_ACCOUNT_GROUP", additionalCustomerNumber: "" };
    }

    const gbm1Account = otherSameVatGroup.find(customer => customer.market === "GBM1");
    if (!gbm1Account) {
      return { eligible: false, reason: "NO_GBM1_ACCOUNT", additionalCustomerNumber: "" };
    }

    return {
      eligible: true,
      reason: "GBO_ACCOUNT",
      additionalCustomerNumber: gbm1Account.number || ""
    };
  }
};
