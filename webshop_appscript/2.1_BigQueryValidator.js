const BigQueryValidator = {
  PROJECT_ID: 'h-apivp-0001-p',
  MAX_REPLACEMENT_HOPS: 3,

  sqlString: function(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  },

  bqValue: function(row, index) {
    return (row.f[index] && row.f[index].v != null) ? String(row.f[index].v).trim() : "";
  },

  quoteList: function(codes) {
    return codes.map(code => `'${this.sqlString(code)}'`).join(',');
  },

  normalizeKey: function(code) {
    return String(code || "").replace(/^0+/, "") || "0";
  },

  isGatePassStatus: function(status) {
    if (!status) return false;
    if (status === CONFIG.ITEM_STATUS.VALID) return true;
    return status.indexOf(CONFIG.ITEM_STATUS.REPLACED + " (") === 0 && status.indexOf(" / ") === -1;
  },

  evaluateSapRow: function(row) {
    const matches = parseInt(row.materialMatches || "0", 10) || 0;
    if (matches === 0) {
      return { status: CONFIG.ITEM_STATUS.NOT_IN_BQ, globalBlock: "", needsReplacement: false };
    }
    if (matches > 1) {
      return { status: CONFIG.ITEM_STATUS.ANOTHER_PROBLEM, globalBlock: "", needsReplacement: false };
    }

    const globalBlock = String(row.globalBlock || "").trim().toUpperCase();
    const salesBlock = String(row.edcSalesBlock || "").trim().toUpperCase();
    const zglpRate = row.zglpRate;

    if (globalBlock === "Z1") {
      return { status: null, globalBlock: globalBlock, needsReplacement: true };
    }
    if (globalBlock === "Z2") {
      return { status: CONFIG.ITEM_STATUS.OBSOLETE, globalBlock: globalBlock, needsReplacement: false };
    }
    if (globalBlock.indexOf("Z") === 0) {
      return { status: CONFIG.ITEM_STATUS.ANOTHER_PROBLEM, globalBlock: globalBlock, needsReplacement: false };
    }
    if (salesBlock.indexOf("Z") === 0) {
      return { status: CONFIG.ITEM_STATUS.BLOCKED, globalBlock: globalBlock, needsReplacement: false };
    }
    if (zglpRate === null || zglpRate === undefined || zglpRate === "") {
      return { status: CONFIG.ITEM_STATUS.NO_GLOBAL_PRICE, globalBlock: globalBlock, needsReplacement: false };
    }

    return { status: CONFIG.ITEM_STATUS.VALID, globalBlock: globalBlock, needsReplacement: false };
  },

  checkItemsInSap: function(codes) {
    if (!codes || codes.length === 0) return {};

    const inputItems = this.quoteList(codes);
    const project = CONFIG.BQ_PROJECT_ID;
    const sql = `
      WITH input AS (
        SELECT input_code FROM UNNEST([${inputItems}]) AS input_code
      ),
      zglp AS (
        SELECT a927.matnr,
               MAX(CASE WHEN konp.kpein > 0
                        THEN CAST(konp.kbetr AS FLOAT64) / CAST(konp.kpein AS INT64) END) AS rate
        FROM \`${project}.sap.a927\` a927
        JOIN \`${project}.sap.konp\` konp ON a927.knumh = konp.knumh
        WHERE CURRENT_DATE() BETWEEN DATE(a927.datab) AND DATE(a927.datbi)
        GROUP BY a927.matnr
      )
      SELECT
        i.input_code,
        COUNT(DISTINCT mara.matnr) AS material_matches,
        MAX(mara.matnr)            AS material_number,
        MAX(mara.mstae)            AS global_block,
        MAX(mvke.vmsta)            AS edc_sales_block,
        MAX(zglp.rate)             AS zglp_rate,
        MAX(makt.maktx)            AS material_description
      FROM input i
      LEFT JOIN \`${project}.sap.mara\` mara
        ON LTRIM(mara.matnr, '0') = LTRIM(i.input_code, '0')
       AND mara.spart IN ('20', '99')
      LEFT JOIN \`${project}.sap.mvke\` mvke
        ON mvke.matnr = mara.matnr AND mvke.vkorg = 'FI61'
      LEFT JOIN zglp ON zglp.matnr = mara.matnr
      LEFT JOIN \`${project}.sap.makt\` makt
        ON makt.matnr = mara.matnr AND makt.spras = 'E'
      GROUP BY i.input_code
    `;

    let results;
    try {
      results = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, this.PROJECT_ID);
    } catch (error) {
      throw new Error(`BigQuery connection failed for SAP item gate: ${error.message}`);
    }

    const byCode = {};
    if (results.rows) {
      results.rows.forEach(row => {
        const inputCode = this.bqValue(row, 0);
        byCode[inputCode] = {
          materialMatches: this.bqValue(row, 1),
          materialNumber: this.bqValue(row, 2),
          globalBlock: this.bqValue(row, 3),
          edcSalesBlock: this.bqValue(row, 4),
          zglpRate: (row.f[5] && row.f[5].v != null) ? row.f[5].v : null,
          materialDescription: this.bqValue(row, 6)
        };
      });
    }
    return byCode;
  },

  resolveReplacements: function(codes) {
    if (!codes || codes.length === 0) return {};

    const inputItems = this.quoteList(codes.map(code => this.normalizeKey(code)));
    const project = CONFIG.BQ_PROJECT_ID;
    const sql = `
      WITH repl AS (
        SELECT LTRIM(kotd001.matwa, '0') AS old_key,
               kondd.smatn               AS new_part,
               DATE(kotd001.datab)       AS valid_from
        FROM \`${project}.sap.kotd001\` kotd001
        JOIN \`${project}.sap.kondd\` kondd ON kotd001.knumh = kondd.knumh
        WHERE CURRENT_DATE() BETWEEN DATE(kotd001.datab) AND DATE(kotd001.datbi)
          AND kondd.smatn IS NOT NULL
          AND LTRIM(kotd001.matwa, '0') IN (${inputItems})
      )
      SELECT old_key,
             STRING_AGG(DISTINCT new_part, ',') AS new_parts,
             COUNT(DISTINCT new_part)           AS new_part_count
      FROM (
        SELECT *, MAX(valid_from) OVER (PARTITION BY old_key) AS latest_from FROM repl
      )
      WHERE valid_from = latest_from
      GROUP BY old_key
    `;

    let results;
    try {
      results = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, this.PROJECT_ID);
    } catch (error) {
      throw new Error(`BigQuery connection failed for replacement lookup: ${error.message}`);
    }

    const byOldKey = {};
    if (results.rows) {
      results.rows.forEach(row => {
        const oldKey = this.bqValue(row, 0);
        byOldKey[oldKey] = {
          newParts: this.bqValue(row, 1),
          newPartCount: parseInt(this.bqValue(row, 2) || "0", 10) || 0
        };
      });
    }
    return byOldKey;
  },

  runSapGate: function(parsedItems) {
    parsedItems.forEach(item => {
      item.resolvedItemName = item.ITEM_NAME;
      item.originalItemName = item.ITEM_NAME;
      item.replacementChain = [];
      item.itemStatus = "";
      item.sapGatePassed = false;
    });

    let pendingCodes = [...new Set(parsedItems.map(item => item.resolvedItemName))];

    for (let hop = 0; hop < this.MAX_REPLACEMENT_HOPS; hop++) {
      const sapRows = this.checkItemsInSap(pendingCodes);
      const needsReplacement = [];

      parsedItems.forEach(item => {
        if (item.itemStatus) return;

        const code = item.resolvedItemName;
        const row = sapRows[code] || { materialMatches: "0" };
        const evaluated = this.evaluateSapRow(row);

        if (evaluated.needsReplacement) {
          needsReplacement.push(item);
          return;
        }

        if (item.replacementChain.length > 0) {
          const chainText = item.replacementChain
            .map(step => `${step.from}->${step.to}`)
            .join(", ");
          const replacedPrefix = `${CONFIG.ITEM_STATUS.REPLACED} (${chainText})`;
          if (evaluated.status === CONFIG.ITEM_STATUS.VALID) {
            item.itemStatus = replacedPrefix;
            item.sapGatePassed = true;
            item.isValid = true;
          } else {
            item.itemStatus = `${replacedPrefix} / ${evaluated.status}`;
            item.sapGatePassed = false;
            item.isValid = false;
          }
        } else {
          item.itemStatus = evaluated.status;
          item.sapGatePassed = evaluated.status === CONFIG.ITEM_STATUS.VALID;
          item.isValid = item.sapGatePassed;
        }
      });

      if (needsReplacement.length === 0) break;

      const oldCodes = [...new Set(needsReplacement.map(item => item.resolvedItemName))];
      const replacements = this.resolveReplacements(oldCodes);
      const nextCodes = [];

      needsReplacement.forEach(item => {
        const oldCode = item.resolvedItemName;
        const oldKey = this.normalizeKey(oldCode);
        const repl = replacements[oldKey];

        if (!repl || repl.newPartCount !== 1 || !repl.newParts) {
          const chainText = item.replacementChain.length > 0
            ? ` (${item.replacementChain.map(step => `${step.from}->${step.to}`).join(", ")})`
            : "";
          item.itemStatus = chainText
            ? `${CONFIG.ITEM_STATUS.REPLACED}${chainText} / ${CONFIG.ITEM_STATUS.ANOTHER_PROBLEM}`
            : CONFIG.ITEM_STATUS.ANOTHER_PROBLEM;
          item.sapGatePassed = false;
          item.isValid = false;
          return;
        }

        const newPart = String(repl.newParts).trim().toUpperCase();
        item.replacementChain.push({ from: oldCode, to: newPart });
        item.resolvedItemName = newPart;
        item.ITEM_NAME = newPart;
        nextCodes.push(newPart);
      });

      pendingCodes = [...new Set(nextCodes)];
      if (pendingCodes.length === 0) break;
    }

    parsedItems.forEach(item => {
      if (!item.itemStatus) {
        const chainText = item.replacementChain.length > 0
          ? ` (${item.replacementChain.map(step => `${step.from}->${step.to}`).join(", ")})`
          : "";
        item.itemStatus = chainText
          ? `${CONFIG.ITEM_STATUS.REPLACED}${chainText} / ${CONFIG.ITEM_STATUS.ANOTHER_PROBLEM}`
          : CONFIG.ITEM_STATUS.ANOTHER_PROBLEM;
        item.sapGatePassed = false;
        item.isValid = false;
      }
    });
  },

  flagInvalidItems: function(parsedItems) {
    if (!parsedItems || parsedItems.length === 0) {
      return { hasInvalid: false, invalidItems: [], clientError: null };
    }

    let hasInvalid = false;
    let invalidItemsList = [];
    let clientErrorMessage = null;

    parsedItems.forEach(item => {
      item.existsInBq = false;
      item.marketMatch = "NOT MATCH";
      item.gboStatus = "NOT GBO";
      item.gboCheck = "NOT_CHECKED";
      item.resolvedCustomerNumber = "";
      item.matchType = "";
      item.itemStatus = "";
      item.resolvedItemName = item.ITEM_NAME;
    });

    // 1. SAP GATE (block / replace / price / sales status)
    this.runSapGate(parsedItems);

    const gatePassedItems = parsedItems.filter(item => item.sapGatePassed);
    gatePassedItems.forEach(item => {
      item.existsInBq = true;
    });

    parsedItems.forEach(item => {
      if (!item.sapGatePassed) {
        item.isValid = false;
        item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (item check: ${item.itemStatus})`;
        hasInvalid = true;
        invalidItemsList.push(item.originalItemName || item.ITEM_NAME);
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

    if (clientErrorMessage) {
      parsedItems.forEach(item => {
        item.marketMatch = "NOT MATCH";
        item.gboStatus = "NOT GBO";
        item.gboCheck = "CLIENT_ERROR";
        item.isValid = false;
        item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (client: ${clientErrorMessage})`;
        hasInvalid = true;
        invalidItemsList.push(item.originalItemName || item.ITEM_NAME);
      });

      invalidItemsList = parsedItems.filter(item => !item.isValid).map(item => item.originalItemName || item.ITEM_NAME);
      hasInvalid = invalidItemsList.length > 0;

      return {
        hasInvalid: hasInvalid,
        invalidItems: [...new Set(invalidItemsList)],
        clientError: clientErrorMessage
      };
    }

    // 3. MARKET + GBO only for items that passed the SAP gate
    if (gatePassedItems.length === 0) {
      invalidItemsList = parsedItems.filter(item => !item.isValid).map(item => item.originalItemName || item.ITEM_NAME);
      hasInvalid = invalidItemsList.length > 0;
      return {
        hasInvalid: hasInvalid,
        invalidItems: [...new Set(invalidItemsList)],
        clientError: clientErrorMessage
      };
    }

    const uniqueResolved = [...new Set(gatePassedItems.map(item => item.resolvedItemName))];
    const inputItems = this.quoteList(uniqueResolved);

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

    const itemsFailingMarket = gatePassedItems.filter(item =>
      validMaterials.includes(item.resolvedItemName) && !validMarketItems.includes(item.resolvedItemName)
    );

    let gboCustomerCheck = { eligible: false, reason: "NOT_CHECKED", additionalCustomerNumber: "" };
    if (itemsFailingMarket.length > 0) {
      gboCustomerCheck = this.checkGboCustomerFallback(safeCustomerName, safeCustomerNumber);
    }

    const originalCustomerNumber = String(customerNumber || "").trim();

    gatePassedItems.forEach(item => {
      const resolvedName = item.resolvedItemName;
      const materialInfo = validMaterialData[resolvedName] || { addCode: "", markets: [] };
      const addCode = materialInfo.addCode || "";
      const isMaterialValid = validMaterials.includes(resolvedName);
      const isMarketValid = validMarketItems.includes(resolvedName);
      const isGboItem = addCode !== "";
      const itemHasGbm1 = materialInfo.markets.indexOf("GBM1") !== -1;

      item.existsInBq = isMaterialValid;
      item.marketMatch = isMarketValid ? "MATCH" : "NOT MATCH";
      item.gboStatus = isGboItem ? "GBO" : "NOT GBO";
      item.resolvedCustomerNumber = "";

      if (!isMaterialValid) {
        item.isValid = false;
        item.gboCheck = "MATERIAL_INVALID";
        item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (standard mismatch and gpo mismatch: not in webshop catalog)`;
        if (item.itemStatus === CONFIG.ITEM_STATUS.VALID || this.isGatePassStatus(item.itemStatus)) {
          // keep replaced(...) text; catalog miss is reported via match_type
        }
        return;
      }

      if (isMaterialValid && isMarketValid) {
        item.isValid = true;
        item.gboCheck = "STANDARD_MATCH";
        item.matchType = CONFIG.MATCH_TYPE.STANDARD;
        item.resolvedCustomerNumber = originalCustomerNumber;
        return;
      }

      if (isMaterialValid && !isMarketValid) {
        if (!isGboItem) {
          item.isValid = false;
          item.gboCheck = "NOT_GBO";
          item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (not gpo)`;
          return;
        }

        if (!gboCustomerCheck.eligible) {
          item.isValid = false;
          item.gboCheck = `GBO_FAIL:${gboCustomerCheck.reason}`;
          item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (standard mismatch and gpo mismatch: ${gboCustomerCheck.reason})`;
          return;
        }

        if (!itemHasGbm1) {
          item.isValid = false;
          item.gboCheck = "GBO_FAIL:ITEM_MARKET_NOT_GBM1";
          item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (standard mismatch and gpo mismatch: ITEM_MARKET_NOT_GBM1)`;
          return;
        }

        const gbm1Number = gboCustomerCheck.additionalCustomerNumber || "";
        item.isValid = true;
        item.gboCheck = "GBO_MATCH";
        item.matchType = `${CONFIG.MATCH_TYPE.GBO} (${originalCustomerNumber}->${gbm1Number})`;
        item.resolvedCustomerNumber = gbm1Number;
        return;
      }

      item.isValid = false;
      item.gboCheck = "MATERIAL_INVALID";
      item.matchType = `${CONFIG.MATCH_TYPE.FAILED} (standard mismatch and gpo mismatch)`;
    });

    invalidItemsList = parsedItems.filter(item => !item.isValid).map(item => item.originalItemName || item.ITEM_NAME);
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
