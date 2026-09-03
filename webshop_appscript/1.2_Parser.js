const Parser = {
  // Prefer ';' when the header line has more semicolons than commas (EU Excel exports).
  detectDelimiter: function(csvString) {
    const firstLine = String(csvString).split(/\r?\n/)[0] || "";
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    return semicolonCount > commaCount ? ";" : ",";
  },

  validateAndParse: function(attachment) {
    const fileName = attachment.getName().toLowerCase();
    let csvString = "";

    if (fileName.endsWith('.csv')) {
      csvString = attachment.getDataAsString();
    } else {
      throw new Error("Unsupported file format. Must be CSV.");
    }

    const delimiter = this.detectDelimiter(csvString);
    const rows = Utilities.parseCsv(csvString, delimiter);
    
    // We expect at least 2 rows: Row 1 (Headers) and Row 2 (Data)
    if (rows.length < 2) throw new Error("File is empty or missing data rows.");

    // NEW LOGIC: Target Row 2 (index 1) for the Client ID and Name
    const firstDataRow = rows[1];
    
    //Safely extract Client ID (Col C) and Client Name (Col D) from Row 2
    const customerNumber = firstDataRow.length > 2 ? String(firstDataRow[2]).trim() : "N/A";
    const fullName = firstDataRow.length > 3 ? String(firstDataRow[3]).trim() : "N/A";

   // STRICT CHECK: If the client name is empty, throw a fatal error immediately
    if (!fullName || fullName.toUpperCase() === "N/A") {
      throw new Error("Client name is missing. It must be provided in row 2, column D.");
    }
    
    let parsedItems = [];
    
    // Loop starts at 1 to skip the header row, processing all data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Skip empty rows or rows that don't have at least the Item and Count columns
      if (row.length < 2 || String(row[0]).trim() === "") continue; 
      
      const itemOrder = String(row[0]).trim().toUpperCase();
      const count = parseInt(row[1], 10);
      
      if (isNaN(count)) throw new Error(`Invalid count at row ${i+1}. Must be an integer.`);
      
      
      parsedItems.push({
        ITEM_NAME: itemOrder,
        ITEM_COUNT: count,
        isValid: true, 
        CUSTOMER_NUMBER: customerNumber, // Attaches the Client ID found in Row 2 to all items
        FULL_NAME: fullName              // Attaches the Client Name found in Row 2 to all items
      });
    }

    if (parsedItems.length === 0) throw new Error("No valid data rows found.");
    return parsedItems;
  },

  batchItems: function(parsedItems, originalFileName) {
    const chunkSize = 100;
    const batches = [];
    const baseName = originalFileName.replace(/\.[^/.]+$/, ""); 

    const needsBatching = parsedItems.length > chunkSize;

    for (let i = 0; i < parsedItems.length; i += chunkSize) {
      const chunk = parsedItems.slice(i, i + chunkSize);
      
      let csvContent = "ITEM_ORDER,COUNT\n";
      chunk.forEach(item => {
        csvContent += `${item.ITEM_NAME},${item.ITEM_COUNT}\n`;
      });

      const partNumber = Math.floor(i / chunkSize) + 1;
      const finalFileName = needsBatching ? `${baseName}_part${partNumber}.csv` : originalFileName;
      
      batches.push({
        fileName: finalFileName,
        csvString: csvContent,
        items: chunk
      });
    }
    return batches;
  },
};

