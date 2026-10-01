/**
 * =========================================================================================
 * MODUŁ: EmailNotifier (Powiadomienia E-mail)
 * =========================================================================================
 * Odpowiada za generowanie i wysyłkę nowoczesnych, responsywnych wiadomości e-mail
 * w procesie automatyzacji zamówień Webshop (Hiab Deals Automation).
 * 
 * Moduł podzielony jest na następujące sekcje:
 * 1. Stałe konfiguracyjne i statusy (CONFIG & VARIANTS)
 * 2. Identyfikacja wizualna i logo (loadLogo, signature, footer)
 * 3. Komponenty UI i formatowanie danych (chips, tabele metadanych, KPI, banery)
 * 4. Główny szablon e-mail (wrapInTemplate)
 * 5. Powiadomienia wewnętrzne dla operatora (sendInternalFeedback)
 * 6. Powiadomienia zewnętrzne dla klienta (sendCustomerFeedback)
 * =========================================================================================
 */
const EmailNotifier = {

  normalizeEmailAddress: function(raw) {
    const text = String(raw || "").trim();
    if (!text || text.toUpperCase() === "N/A") {
      return "";
    }
    const angle = text.match(/<([^>\s]+@[^>\s]+)>/);
    if (angle) {
      return angle[1].trim();
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      return text;
    }
    return "";
  },

  // =======================================================================================
  // 1. STAŁE KONFIGURACYJNE I STATUSY
  // =======================================================================================

  // ID folderu na Google Drive z oficjalnym logo HIAB
  get logoFolderId() {
    return (typeof CONFIG !== "undefined" && CONFIG.LOGO_FOLDER_ID) || "1gt3Zvlq2Et7BlEhdUAJ5e0QmtnrakMdv";
  },

  get logoFileName() {
    return (typeof CONFIG !== "undefined" && CONFIG.LOGO_FILE_NAME) || "hiab-text-logo.png";
  },
  
  // Nazwa nadawcy wyświetlana odbiorcom w programach pocztowych
  SENDER_NAME: "Hiab Deals Automation",

  // Warianty statusów powiadomień wewnętrznych dla operatora zgłaszającego plik:
  VARIANTS: {
    VALID: "VALID",                 // Plik zweryfikowany pomyślnie, oczekuje na wgranie przez robota
    FATAL: "FATAL",                 // Błąd krytyczny pliku (zły format, brak wymaganych kolumn)
    REJECTED: "REJECTED",           // Pozycje nie przeszły walidacji biznesowej / BigQuery / dane klienta
    UPLOAD_FAILED: "UPLOAD_FAILED", // Robot uległ awarii przy tworzeniu koszyka
    CART_COMPLETED: "CART_COMPLETED" // Koszyk złożony — podsumowanie wyniku z webshopu
  },

  // =======================================================================================
  // 2. IDENTYFIKACJA WIZUALNA I OBSŁUGA LOGO
  // =======================================================================================

  /**
   * Bezpiecznie ładuje logo HIAB z Google Drive jako Blob i rejestruje w inlineImages.
   * Umożliwia wyświetlenie grafiki przez cid:hiabLogo bez blokowania przez klientów pocztowych.
   * W razie błędu uprawnień/braku pliku nie przerywa działania (graceful fallback).
   * 
   * @param {Object} inlineImages - Obiekt obrazów przekazywany do GmailApp
   * @returns {boolean} True jeśli logo zostało załadowane pomyślnie
   */
  loadLogo: function(inlineImages) {
    if (!inlineImages) return false;
    if (inlineImages['hiabLogo']) return true;
    try {
      if (typeof DriveApp !== 'undefined' && DriveApp.getFolderById) {
        const folder = DriveApp.getFolderById(this.logoFolderId);
        const files = folder.getFilesByName(this.logoFileName);
        if (files && files.hasNext()) {
          inlineImages['hiabLogo'] = files.next().getBlob();
          return true;
        }
      }
    } catch (e) {
      if (typeof Logger !== 'undefined') {
        Logger.log("Could not load logo from Drive: " + e.message);
      }
    }
    return false;
  },

  /**
   * Generuje estetyczny podpis wiadomości z oficjalną nazwą nadawcy
   * oraz osadzoną grafiką logo HIAB (lub ostylowanym tekstem w razie braku grafiki).
   * 
   * @param {Object} inlineImages - Słownik obrazów inline
   * @returns {string} Kod HTML podpisu
   */
  signature: function(inlineImages) {
    const hasLogo = this.loadLogo(inlineImages);
    const logoHtml = hasLogo
      ? `<div style="margin-top: 8px;"><img src="cid:hiabLogo" alt="HIAB Logo" style="height: 28px; max-height: 28px; width: auto; display: block; border: 0;"></div>`
      : `<div style="margin-top: 6px; font-size: 16px; font-weight: 900; color: #D52B1E; font-family: Arial, Helvetica, sans-serif;">HIAB</div>`;

    return `
      <div style="margin-top: 26px; padding-top: 20px; border-top: 1px solid #e4e6e8;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #6b7480;">Best regards,</p>
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 700; color: #2f3941;">${this.SENDER_NAME}</p>
        ${logoHtml}
      </div>
    `;
  },

  /**
   * Generuje dolną stopkę informacyjną z adnotacją o systemie automatycznym.
   * 
   * @param {string} [note] - Opcjonalna treść instrukcji w stopce
   * @returns {string} Kod HTML stopki
   */
  footer: function(note) {
    return `
      <div style="background-color: #f7f7f7; border-top: 1px solid #e4e6e8; padding: 18px 28px; text-align: center;">
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #6b7480;">
          <strong style="color: #2f3941;">HIAB Deals Automation System</strong> &bull; This is an automated notification.<br>
          ${note || "Please do not reply directly to this email."}
        </p>
      </div>
    `;
  },

  // =======================================================================================
  // 3. FORMATOWANIE DANYCH I KOMPONENTY WIZUALNE (UI HELPERS)
  // =======================================================================================

  /**
   * Formatuje tablicę kodów materiałów w estetyczne tagi/chipy (monospace) z obramowaniem.
   * Ułatwia skanowanie wzrokiem i szybkie kopiowanie pojedynczych indeksów części.
   * 
   * @param {Array<string|Object>} entries - Tablica kodów lub obiektów pozycji
   * @param {number} [limit] - Maksymalna liczba wyświetlanych kodów
   * @returns {string} Kod HTML z kafelkami pozycji
   */
  renderChips: function(entries, limit) {
    const max = limit || (typeof CONFIG !== 'undefined' ? CONFIG.CUSTOMER_LIST_LIMIT : 25);
    const names = (entries || []).map(entry =>
      typeof entry === "string" ? entry : (entry.label || entry.item || "")
    ).filter(Boolean);

    if (names.length === 0) {
      return '<span style="color: #8a9199; font-style: italic;">None</span>';
    }

    const chips = names.slice(0, max).map(code => 
      `<span style="display: inline-block; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 700; background-color: #f7f7f7; color: #2f3941; border: 1px solid #e4e6e8; border-radius: 2px; padding: 3px 8px; margin: 2px 3px 2px 0; letter-spacing: 0.2px;">${code}</span>`
    ).join('');

    const more = names.length > max
      ? `<span style="display: inline-block; font-size: 12px; color: #6b7480; font-style: italic; margin-left: 4px;">(+${names.length - max} more)</span>`
      : '';

    return chips + more;
  },

  /**
   * Wrapper zachowany dla wstecznej kompatybilności.
   * Wewnętrznie przekazuje wywołanie do renderChips.
   * 
   * @param {Array<string|Object>} entries - Tablica kodów lub obiektów pozycji
   * @param {number} [limit] - Maksymalna liczba elementów
   * @returns {string} Kod HTML z kodami pozycji
   */
  renderList: function(entries, limit) {
    return this.renderChips(entries, limit);
  },

  /**
   * Tabela pozycji wgranych do webshopu (kod materiału + ilość).
   *
   * @param {Array<{item: string, label?: string, quantity: number}>} entries
   * @returns {string}
   */
  renderProcessedItemsTable: function(entries) {
    const limit = typeof CONFIG !== 'undefined' ? CONFIG.CUSTOMER_LIST_LIMIT : 25;
    const items = entries || [];

    if (items.length === 0) {
      return `
        <p style="margin: 0; font-size: 13px; color: #6b7480; font-style: italic;">
          No item details were recorded for this saved cart.
        </p>
      `;
    }

    // Mirrors the "Saved cart lines" table in the webshop: dark header, numbered rows.
    const rows = items.slice(0, limit).map((entry, index) => {
      const bg = index % 2 === 0 ? '#ffffff' : '#f7f7f7';
      const code = entry.label || entry.item || '';
      const qty = entry.quantity > 1 ? entry.quantity : 1;
      return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e4e6e8;">
          <td style="padding: 12px 10px 12px 16px; font-size: 13px; color: #8a9199; width: 34px;">${index + 1}</td>
          <td style="padding: 12px 10px; font-size: 13px; font-weight: 700; color: #2f3941; letter-spacing: 0.2px;">${code}</td>
          <td style="padding: 12px 16px 12px 10px; font-size: 13px; color: #2f3941; text-align: right; white-space: nowrap;">${qty} pieces</td>
        </tr>
      `;
    }).join('');

    const more = items.length > limit
      ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7480; font-style: italic;">(+${items.length - limit} more items in the saved cart)</p>`
      : '';

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; border: 1px solid #e4e6e8;">
        <thead>
          <tr style="background-color: #3d4852;">
            <th style="padding: 12px 10px 12px 16px; width: 34px;"></th>
            <th style="padding: 12px 10px; font-size: 13px; font-weight: 700; text-align: left; color: #ffffff;">Material</th>
            <th style="padding: 12px 16px 12px 10px; font-size: 13px; font-weight: 700; text-align: right; color: #ffffff;">Quantity</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}
    `;
  },

  /**
   * Przycisk CTA prowadzący do listy zapisanych koszyków w webshopie.
   *
   * @param {string} [label] - Tekst przycisku
   * @returns {string} Kod HTML przycisku
   */
  renderSavedCartsButton: function(label) {
    const url = typeof CONFIG !== 'undefined' && CONFIG.SAVED_CARTS_URL
      ? CONFIG.SAVED_CARTS_URL
      : "https://webshop.hiab.com/en/my-account/saved-carts/";

    return `
      <table cellpadding="0" cellspacing="0" border="0" style="margin: 22px 0 6px 0;">
        <tr>
          <td style="background-color: #D52B1E; border-radius: 2px;">
            <a href="${url}" style="display: inline-block; padding: 13px 26px; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; letter-spacing: 0.3px;">
              ${label || "View your saved carts"}
            </a>
          </td>
        </tr>
      </table>
    `;
  },

  /**
   * Renderuje dwukolumnową tabelę z metadanymi zamówienia
   * (plik nadesłany, konto klienta, adres powiadomień) z naprzemiennym tłem wierszy.
   * 
   * @param {Array<{label: string, value: string}>} items - Lista par etykieta/wartość
   * @returns {string} Kod HTML tabeli metadanych
   */
  renderMetadataTable: function(items) {
    const rows = items.map((item, index) => {
      const bg = index % 2 === 0 ? '#ffffff' : '#f7f7f7';
      return `
        <tr style="background-color: ${bg};">
          <td style="padding: 11px 14px; font-size: 12px; font-weight: 700; color: #6b7480; text-transform: uppercase; letter-spacing: 0.4px; width: 34%; border-bottom: 1px solid #e4e6e8;">${item.label}</td>
          <td style="padding: 11px 14px; font-size: 13px; font-weight: 500; color: #2f3941; border-bottom: 1px solid #e4e6e8;">${item.value}</td>
        </tr>
      `;
    }).join('');

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e4e6e8; margin: 16px 0 18px 0;">
        ${rows}
      </table>
    `;
  },

  /**
   * Renderuje rząd estetycznych kafelków z kluczowymi wskaźnikami liczbowymi (KPI):
   * Total Items, Passed, Rejected, Replaced z dużymi liczbami i odpowiednimi kolorami statusów.
   * 
   * @param {Array<{label: string, value: number, color: string}>} stats - Statystyki liczbowe
   * @returns {string} Kod HTML rzędu z kafelkami KPI
   */
  renderKpiCards: function(stats) {
    const cells = stats.map(stat => `
      <td align="center" style="padding: 3px; width: ${Math.floor(100 / stats.length)}%;">
        <div style="background-color: #ffffff; border: 1px solid #e4e6e8; padding: 14px 6px;">
          <div style="font-size: 24px; font-weight: 800; color: ${stat.color || '#2f3941'}; line-height: 1;">${stat.value}</div>
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7480; margin-top: 6px;">${stat.label}</div>
        </div>
      </td>
    `).join('');

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 14px 0 18px 0;">
        <tr>${cells}</tr>
      </table>
    `;
  },

  /**
   * Generuje wyróżniający się baner statusu zamówienia dopasowany do wariantu:
   * (VALID, REJECTED, FATAL, UPLOAD_FAILED, CUSTOMER_COMPLETED).
   * 
   * @param {string} variant - Identyfikator wariantu statusu
   * @returns {string} Kod HTML banera statusu
   */
  renderStatusBanner: function(variant) {
    const configs = {
      [this.VARIANTS.VALID]: {
        badge: "READY FOR WEBSHOP UPLOAD",
        badgeColor: "#15803d",
        title: "Validation Passed",
        desc: "The file passed data validation and is queued for automated upload to the webshop.",
        bannerBg: "#f0fdf4",
        titleColor: "#1e293b",
        descColor: "#475569",
        accent: "#15803d",
        radius: "6px"
      },
      [this.VARIANTS.REJECTED]: {
        badge: "VALIDATION FAILED",
        badgeColor: "#991b1b",
        title: "Order File Rejected",
        desc: "Items failed validation checks. The entire file was rejected and will not be uploaded.",
        bannerBg: "#fef2f2",
        titleColor: "#1e293b",
        descColor: "#475569",
        accent: "#b91c1c",
        radius: "6px"
      },
      [this.VARIANTS.FATAL]: {
        badge: "FATAL ERROR",
        badgeColor: "#ffffff",
        title: "File Processing Failed",
        desc: "The uploaded file could not be processed due to a structural or format error.",
        bannerBg: "#8a1f2b",
        titleColor: "#ffffff",
        descColor: "#f3d4d8",
        accent: "#D52B1E"
      },
      [this.VARIANTS.UPLOAD_FAILED]: {
        badge: "ROBOT UPLOAD FAILED",
        badgeColor: "#ffffff",
        title: "Webshop Upload Error",
        desc: "The automation robot could not complete the saved cart in the webshop.",
        bannerBg: "#8a5a12",
        titleColor: "#ffffff",
        descColor: "#f5e6c8",
        accent: "#D52B1E"
      },
      [this.VARIANTS.CART_COMPLETED]: {
        badge: "SAVED CART COMPLETED",
        badgeColor: "#15803d",
        title: "",
        desc: "",
        bannerBg: "#f0fdf4",
        titleColor: "#1e293b",
        descColor: "#475569",
        accent: "#15803d",
        radius: "6px"
      },
      CUSTOMER_COMPLETED: {
        badge: "SAVED CART READY",
        badgeColor: "#ffffff",
        title: "Order Processed Successfully",
        desc: "We have finished processing your webshop order.",
        bannerBg: "#3d4852",
        titleColor: "#ffffff",
        descColor: "#d5d9dd",
        accent: "#D52B1E"
      }
    };

    const cfg = configs[variant] || configs[this.VARIANTS.VALID];
    const radius = cfg.radius || "0";

    const titleBlock = cfg.title
      ? `<div style="font-size: 13px; color: ${cfg.titleColor}; font-weight: 600; margin-bottom: 2px;">${cfg.title}</div>`
      : "";
    const descBlock = cfg.desc
      ? `<div style="font-size: 13px; color: ${cfg.descColor};">${cfg.desc}</div>`
      : "";

    return `
      <div style="background-color: ${cfg.bannerBg}; border-radius: ${radius}; padding: 14px 18px; margin: 14px 0 18px 0; line-height: 1.5; border-left: 4px solid ${cfg.accent};">
        <div style="font-weight: 700; font-size: 13px; color: ${cfg.badgeColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0;">
          ${cfg.badge}
        </div>
        ${titleBlock}
        ${descBlock}
      </div>
    `;
  },

  /**
   * Generuje nowoczesną tabelę pozycji zamienionych (zastąpionych nowszymi indeksami).
   * Prezentuje: kod zamówiony, kod wynikowy (sukcesor), pełen łańcuch zamian oraz ostrzeżenia.
   * 
   * @param {Array<{originalItem: string, currentItem: string, chain: string, warning: string}>} replacedItems
   * @returns {string} Kod HTML tabeli zamienników (lub pusty ciąg, jeśli brak zamienników)
   */
  replacementTable: function(replacedItems) {
    if (!replacedItems || replacedItems.length === 0) return '';

    const rows = replacedItems.map((entry, index) => {
      const bg = index % 2 === 0 ? '#ffffff' : '#f7f7f7';
      const warningText = entry.warning 
        ? `<span style="color: #D52B1E; font-weight: 700; font-size: 12px;">${entry.warning}</span>`
        : '<span style="color: #8a9199; font-size: 12px;">None</span>';

      return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e4e6e8;">
          <td style="padding: 11px 12px; font-size: 13px;">
            <span style="font-weight: 700; color: #2f3941;">${entry.originalItem}</span>
          </td>
          <td style="padding: 11px 12px; font-size: 13px;">
            <span style="font-weight: 700; color: #2f3941;">${entry.currentItem}</span>
          </td>
          <td style="padding: 11px 12px; font-size: 12px; color: #4a5560;">${entry.chain}</td>
          <td style="padding: 11px 12px; font-size: 12px;">${warningText}</td>
        </tr>
      `;
    }).join('');

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; border: 1px solid #e4e6e8; margin: 10px 0 18px 0;">
        <thead>
          <tr style="background-color: #3d4852;">
            <th style="padding: 11px 12px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Ordered Item</th>
            <th style="padding: 11px 12px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Processed Item</th>
            <th style="padding: 11px 12px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Replacement Chain</th>
            <th style="padding: 11px 12px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Warning</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  },

  webshopRejectedTable: function(rejectedItems) {
    if (!rejectedItems || rejectedItems.length === 0) return "";

    const rows = rejectedItems.map((entry, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#f7f7f7";
      const code = entry.originalItem && entry.originalItem !== entry.item
        ? `${entry.originalItem} &rarr; ${entry.item}`
        : entry.item;
      return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e4e6e8;">
          <td style="padding: 11px 12px; font-size: 13px; font-weight: 700; color: #2f3941;">${code}</td>
          <td style="padding: 11px 12px; font-size: 12px; color: #4a5560;">${entry.status}</td>
        </tr>
      `;
    }).join("");

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; border: 1px solid #e4e6e8; margin: 10px 0 18px 0;">
        <thead>
          <tr style="background-color: #3d4852;">
            <th style="padding: 11px 12px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Item</th>
            <th style="padding: 11px 12px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Webshop message</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },

  /**
   * Przekształca obiekt błędów weryfikacji klienta w Salesforce w listę czytelnych komunikatów
   * (brak ID klienta, nie znaleziono w Salesforce, rozbieżność nazwy firmy, brak e-maila).
   * 
   * @param {Object} clientError - Flagi błędów z ItemsReport
   * @returns {Array<string>} Lista sformatowanych komunikatów o błędach klienta
   */
  clientCheckMessages: function(clientError) {
    const messages = [];
    if (!clientError) return messages;

    if (clientError.missingId) {
      messages.push(`Customer ID is missing from the file. (${(CONFIG.CLIENT_ERRORS && CONFIG.CLIENT_ERRORS.MISSING_ID) || 'MISSING_ID'})`);
    }
    if (clientError.notFound) {
      messages.push(`Customer ID was not found in Salesforce. (${(CONFIG.CLIENT_ERRORS && CONFIG.CLIENT_ERRORS.NOT_FOUND) || 'CLIENT_NOT_FOUND'})`);
    }
    if (clientError.wrongName) {
      messages.push(`${clientError.wrongName} (${(CONFIG.CLIENT_ERRORS && CONFIG.CLIENT_ERRORS.WRONG_NAME) || 'WRONG_NAME'})`);
    }
    if (clientError.noEmail) {
      messages.push(`No e-mail address found for this customer contact. (${(CONFIG.CLIENT_ERRORS && CONFIG.CLIENT_ERRORS.NO_EMAIL) || 'NO_CUSTOMER_EMAIL'})`);
    }
    if (clientError.other) {
      messages.push(clientError.other);
    }

    return messages;
  },

  /**
   * Tworzy przejrzystą tabelę odrzuconych pozycji z podziałem na kategorie biznesowe
   * (brak w BigQuery, zablokowane, brak ceny globalnej, wycofane, inny problem itp.).
   * 
   * @param {Object} report - Obiekt raportu ItemsReport
   * @returns {string} Kod HTML tabeli odrzuceń (lub pusty ciąg, jeśli brak odrzuceń)
   */
  rejectedSections: function(report) {
    const sections = [
      { label: "Not found in BigQuery", entries: report.notInBq },
      { label: "Blocked for sale", entries: report.blocked },
      { label: "No global price", entries: report.noGlobalPrice },
      { label: "Obsolete", entries: report.obsolete },
      { label: "Failed market / GPO match", entries: report.failedMatch },
      { label: "Needs webshop support", entries: report.anotherProblem },
      { label: "Not validated yet", entries: report.pending },
      { label: "Other problem", entries: report.other }
    ];

    const activeSections = sections.filter(sec => sec.entries && sec.entries.length > 0);
    if (activeSections.length === 0) return '';

    const rows = activeSections.map((sec, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f7f7f7';
      return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e4e6e8;">
          <td style="padding: 12px 14px; vertical-align: top; width: 36%;">
            <div style="font-weight: 700; color: #2f3941; font-size: 13px;">${sec.label}</div>
            <div style="font-size: 11px; color: #6b7480; margin-top: 2px;">${sec.entries.length} ${sec.entries.length === 1 ? 'item' : 'items'}</div>
          </td>
          <td style="padding: 12px 14px; vertical-align: top;">
            ${this.renderChips(sec.entries, 50)}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; border: 1px solid #e4e6e8; margin: 10px 0 18px 0;">
        <thead>
          <tr style="background-color: #3d4852;">
            <th style="padding: 12px 14px; font-size: 13px; font-weight: 700; color: #ffffff; text-align: left;">Category</th>
            <th style="padding: 12px 14px; font-size: 13px; font-weight: 700; color: #ffffff; text-align: left;">Material</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  },

  // =======================================================================================
  // 4. GŁÓWNY SZABLON WIADOMOŚCI (MASTER TEMPLATE WRAPPER)
  // =======================================================================================

  /**
   * Otacza właściwą treść wiadomości eleganckim szablonem HTML:
   * - Zewnętrzne tło (#f4f6f9),
   * - Wyśrodkowana responsywna karta (szerokość maks. 620px, zaokrąglone rogi 12px, subtelny cień),
   * - Czerwony pasek akcentowy marki HIAB (#D52B1E) na samej górze karty,
   * - Nagłówek z logo i systemową odznaką CX Center,
   * - Wstrzyknięta treść główna (contentHtml),
   * - Spójna stopka systemowa.
   * 
   * @param {string} contentHtml - Właściwa treść wiadomości
   * @param {Object} inlineImages - Słownik obrazów inline
   * @param {Object} [options] - Opcje szablonu (tytuł dokumentu, treść notatki w stopce)
   * @returns {string} Kompletny kod dokumentu HTML e-maila
   */
  wrapInTemplate: function(contentHtml, inlineImages, options) {
    const hasLogo = this.loadLogo(inlineImages);
    const logoHtml = hasLogo
      ? `<img src="cid:hiabLogo" alt="HIAB" style="height: 32px; max-height: 32px; width: auto; display: block; border: 0;">`
      : `<span style="font-size: 22px; font-weight: 900; letter-spacing: 0.5px; color: #D52B1E; font-family: Arial, Helvetica, sans-serif;">HIAB</span>`;

    const title = (options && options.title) || "Deals Automation";

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f2f3f4; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased; color: #2f3941;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f2f3f4; width: 100% !important; margin: 0; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Główna karta wiadomości -->
        <table cellpadding="0" cellspacing="0" border="0" width="620" style="max-width: 620px; width: 100%; background-color: #ffffff; border-radius: 2px; overflow: hidden; border: 1px solid #e4e6e8;">
          
          <!-- Górny pasek akcentowy marki HIAB -->
          <tr>
            <td style="height: 4px; background-color: #D52B1E; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Nagłówek wiadomości z logo -->
          <tr>
            <td style="padding: 20px 28px; border-bottom: 1px solid #e4e6e8; background-color: #ffffff;">
              ${logoHtml}
            </td>
          </tr>

          <!-- Właściwa zawartość e-maila -->
          <tr>
            <td style="padding: 24px 28px 28px 28px; font-size: 14px; line-height: 1.5; color: #2f3941;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Dolna stopka -->
          <tr>
            <td>
              ${this.footer(options && options.footerNote)}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  },

  // =======================================================================================
  // 5. POWIADOMIENIE WEWNĘTRZNE DLA OPERATORA (sendInternalFeedback)
  // =======================================================================================

  /**
   * Wysyła techniczne podsumowanie do operatora, który nadesłał plik z zamówieniem.
   * Wiadomość jest wysyłana jako odpowiedź w oryginalnym wątku Gmail (message.reply)
   * tuż po ustawieniu fazy 5_VALID lub -1_ERROR.
   * 
   * Obsługuje 4 warianty:
   * - VALID: Plik przeszedł walidację, robot wgra pozycje do webshopu.
   * - REJECTED: Błędy walidacji danych / pozycji / klienta; plik odrzucony, wymagana akcja.
   * - FATAL: Błąd formatu pliku lub struktury kolumn (wymagany określony szablon kolumn).
   * - UPLOAD_FAILED: Walidacja powiodła się, lecz robot uległ awarii w trakcie tworzenia koszyka.
   * 
   * @param {GmailMessage} message - Oryginalna wiadomość Gmail, w wątku której wysyłana jest odpowiedź
   * @param {Object} info - Informacje o zamówieniu:
   *   @param {string} info.internalName - Imię/nazwa operatora zgłaszającego
   *   @param {string} info.customerName - Nazwa klienta
   *   @param {string} [info.customerNumber] - Numer klienta w systemie
   *   @param {string} [info.customerEmail] - Docelowy adres e-mail klienta
   *   @param {string} info.attachmentName - Nazwa nadesłanego pliku
   *   @param {string} info.variant - Wariant statusu (VALID, REJECTED, FATAL, UPLOAD_FAILED)
   *   @param {string} [info.errorMessage] - Komunikat błędu (dla FATAL / UPLOAD_FAILED)
   *   @param {Object} info.report - Obiekt raportu ItemsReport
   */
  sendInternalFeedback: function(message, info) {
    const report = info.report || { total: 0, ready: [], rejectedCount: 0, replaced: [] };
    const inlineImages = {};
    const customerLine = info.customerNumber ? `${info.customerName} (${info.customerNumber})` : info.customerName;

    let content = `
      <p style="margin: 0 0 14px 0; font-size: 16px; color: #2f3941;">Hello <strong>${info.internalName}</strong>,</p>
      <p style="margin: 0 0 18px 0; font-size: 14px; color: #4a5560; line-height: 1.6;">
        Here is the automated processing overview for file <strong style="color: #2f3941;">${info.attachmentName}</strong>
        (Customer: <strong style="color: #2f3941;">${customerLine}</strong>).
      </p>
    `;

    // Status Banner
    content += this.renderStatusBanner(info.variant);

    if (info.variant === this.VARIANTS.CART_COMPLETED) {
      content += this.renderKpiCards([
        { label: "Total Items", value: report.total, color: "#2f3941" },
        { label: "In Saved Cart", value: (report.processed || []).length, color: "#15803d" },
        { label: "Rejected", value: (report.webshopRejected || []).length, color: ((report.webshopRejected || []).length > 0 ? "#D52B1E" : "#6b7480") }
      ]);
    } else if (info.variant === this.VARIANTS.VALID || info.variant === this.VARIANTS.REJECTED || info.variant === this.VARIANTS.UPLOAD_FAILED) {
      content += this.renderKpiCards([
        { label: "Total Items", value: report.total, color: "#2f3941" },
        { label: "Passed", value: (report.ready || []).length, color: "#3d4852" },
        { label: "Rejected", value: report.rejectedCount || 0, color: (report.rejectedCount > 0 ? "#D52B1E" : "#6b7480") },
        { label: "Replaced", value: (report.replaced || []).length, color: "#2f3941" }
      ]);
    }

    // Variant-specific details
    if (info.variant === this.VARIANTS.FATAL) {
      content += `
        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; border-left: 4px solid #D52B1E; padding: 14px 16px; margin: 16px 0;">
          <div style="font-weight: 700; color: #2f3941; font-size: 13px; margin-bottom: 4px;">Reason for Failure</div>
          <div style="font-size: 13px; color: #4a5560;">${info.errorMessage}</div>
        </div>

        <div style="margin: 16px 0;">
          <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Required file layout</h3>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; border: 1px solid #e4e6e8;">
            <thead>
              <tr style="background-color: #3d4852;">
                <th style="padding: 11px 14px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left; width: 56px;">Col</th>
                <th style="padding: 11px 14px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: left;">Content</th>
              </tr>
            </thead>
            <tbody>
              <tr style="background-color: #ffffff; border-bottom: 1px solid #e4e6e8;"><td style="padding: 11px 14px; font-weight: 700; color: #2f3941;">A</td><td style="padding: 11px 14px; color: #4a5560;">Item Number (Material code)</td></tr>
              <tr style="background-color: #f7f7f7; border-bottom: 1px solid #e4e6e8;"><td style="padding: 11px 14px; font-weight: 700; color: #2f3941;">B</td><td style="padding: 11px 14px; color: #4a5560;">Order Amount (Quantity)</td></tr>
              <tr style="background-color: #ffffff; border-bottom: 1px solid #e4e6e8;"><td style="padding: 11px 14px; font-weight: 700; color: #2f3941;">C</td><td style="padding: 11px 14px; color: #4a5560;">Customer ID</td></tr>
              <tr style="background-color: #f7f7f7;"><td style="padding: 11px 14px; font-weight: 700; color: #2f3941;">D</td><td style="padding: 11px 14px; color: #4a5560;">Customer Name</td></tr>
            </tbody>
          </table>
          <p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7480;">* Row 1 is reserved for column headers.</p>
        </div>

        <p style="margin: 16px 0 0 0; font-size: 13px; color: #4a5560;">
          Please correct the file structure according to the specifications above and resubmit it to
          <a href="mailto:${CONFIG.TARGET_EMAIL}" style="color: #D52B1E; font-weight: 700; text-decoration: none;">${CONFIG.TARGET_EMAIL}</a>.
        </p>
      `;
    }
    else if (info.variant === this.VARIANTS.REJECTED) {
      const clientMessages = this.clientCheckMessages(report.clientError);
      if (clientMessages.length > 0) {
        content += `
          <div style="background-color: #fef2f2; border-left: 4px solid #b91c1c; border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 16px 0;">
            <div style="font-weight: 700; color: #7f1d1d; font-size: 13px; margin-bottom: 6px;">Client Verification Notice:</div>
            <ul style="margin: 0; padding-left: 18px; color: #991b1b; font-size: 13px;">
              ${clientMessages.map(text => `<li style="margin-bottom: 3px;">${text}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      const rejected = this.rejectedSections(report);
      if (rejected) {
        content += `
          <div style="margin-top: 18px;">
            <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Items that will not be uploaded (Action Required)</h3>
            ${rejected}
          </div>
        `;
      }

      if (report.replaced && report.replaced.length > 0) {
        content += `
          <div style="margin-top: 18px;">
            <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Replaced items (successor resolved, would be uploaded)</h3>
            ${this.replacementTable(report.replaced)}
          </div>
        `;
      }

      content += `
        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; border-left: 4px solid #D52B1E; padding: 14px 18px; margin-top: 18px;">
          <div style="font-weight: 700; color: #2f3941; font-size: 13px;">Submission Notice</div>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #4a5560; line-height: 1.5;">
            The entire file was rejected and nothing was uploaded to the webshop.<br>
            Please review the rejected items above, correct the file in the system, and resubmit.
          </p>
        </div>
      `;
    }
    else if (info.variant === this.VARIANTS.UPLOAD_FAILED) {
      content += `
        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; border-left: 4px solid #D52B1E; padding: 14px 16px; margin: 16px 0;">
          <div style="font-weight: 700; color: #2f3941; font-size: 13px; margin-bottom: 4px;">Upload error reason</div>
          <div style="font-size: 13px; color: #4a5560;">${info.errorMessage}</div>
        </div>

        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; padding: 14px 16px; margin: 16px 0;">
          <p style="margin: 0; font-size: 13px; color: #4a5560; line-height: 1.5;">
            The automation robot could not finalize the webshop saved cart.
            <br><br>
            <strong style="color: #2f3941;">Note:</strong> The customer has <strong>NOT</strong> been notified.
            <br>
            Please check the webshop session and retry the upload.
          </p>
        </div>
      `;
    }
    else if (info.variant === this.VARIANTS.CART_COMPLETED) {
      const savedCartName = String(info.savedCartName || "").trim();
      if (savedCartName) {
        content += `
          <p style="margin: 0 0 16px 0; font-size: 13px; color: #4a5560;">
            Saved cart name in webshop: <strong style="color: #2f3941;">${savedCartName}</strong>
          </p>
        `;
      }

      content += `
        <div style="margin: 0 0 18px 0;">
          <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Lines added to saved cart</h3>
          ${this.renderProcessedItemsTable(report.processed || [])}
        </div>
      `;

      if (report.webshopRejected && report.webshopRejected.length > 0) {
        content += `
          <div style="margin-top: 18px;">
            <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Items rejected by the webshop</h3>
            ${this.webshopRejectedTable(report.webshopRejected)}
          </div>
        `;
      }

      content += `
        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; border-left: 4px solid #15803d; padding: 14px 18px; margin-top: 18px;">
          <div style="font-weight: 700; color: #2f3941; font-size: 13px;">Customer notification</div>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #4a5560; line-height: 1.5;">
            ${info.customerEmail
              ? `Confirmation e-mail sent to <strong style="color: #2f3941;">${info.customerEmail}</strong>.`
              : "No customer e-mail in column G — only this internal summary was sent."}
          </p>
        </div>
      `;
    }
    else {
      // VALID
      if (report.replaced && report.replaced.length > 0) {
        content += `
          <div style="margin-top: 18px;">
            <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Replaced items (successors will be uploaded)</h3>
            ${this.replacementTable(report.replaced)}
          </div>
        `;
      }

      content += `
        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; border-left: 4px solid #D52B1E; padding: 14px 18px; margin-top: 18px;">
          <div style="font-weight: 700; color: #2f3941; font-size: 13px;">Automatic Process in Progress</div>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #4a5560; line-height: 1.5;">
            No operator action required. The automation robot will upload this file to the webshop.
            ${info.customerEmail ? `<br>Customer notification will be sent automatically to: <strong style="color: #2f3941;">${info.customerEmail}</strong>.` : ''}
          </p>
        </div>
      `;
    }

    content += this.signature(inlineImages);

    const emailBody = this.wrapInTemplate(content, inlineImages, {
      title: "Hiab Deals Submission Overview",
      footerNote: "Please do not reply directly to this notification email."
    });

    const replyOptions = {
      htmlBody: emailBody,
      name: this.SENDER_NAME,
      inlineImages: inlineImages
    };
    const directTo = this.normalizeEmailAddress(info.deliveryTo);
    if (directTo) {
      GmailApp.sendEmail(
        directTo,
        info.emailSubject || "Hiab Deals Submission Overview",
        "",
        replyOptions
      );
      return;
    }
    if (!message) {
      throw new Error("sendInternalFeedback requires a Gmail message or info.deliveryTo for direct send.");
    }
    try {
      message.reply("", replyOptions);
    } catch (replyError) {
      const to = this.normalizeEmailAddress(message.getFrom());
      if (!to) {
        throw replyError;
      }
      Logger.log(`message.reply failed (${replyError.message}); sending internal mail to ${to}`);
      GmailApp.sendEmail(to, "Re: " + (message.getSubject() || "Hiab Deals submission"), "", replyOptions);
    }
  },

  // =======================================================================================
  // 6. POWIADOMIENIE DLA KLIENTA ZEWNĘTRZNEGO (sendCustomerFeedback)
  // =======================================================================================

  /**
   * Wysyła oficjalne, estetyczne potwierdzenie realizacji zamówienia bezpośrednio do klienta.
   * Wysyłane jako osobna wiadomość e-mail po zakończeniu fazy FINISHED przez robota.
   * 
   * Klient otrzymuje jasne podsumowanie zamówienia, a w przypadku wystąpienia zamienników
   * lub pozycji niedostępnych/wycofanych – czytelną tabelę z wyjaśnieniem sytuacji.
   * 
   * @param {Object} info - Informacje o zamówieniu klienta:
   *   @param {string} info.customerEmail - Docelowy adres e-mail klienta
   *   @param {string} info.customerName - Nazwa firmy / klienta
   *   @param {string} [info.internalEmail] - Opcjonalny adres reply-to do przedstawiciela HIAB
   *   @param {string} [info.savedCartName] - Nazwa zapisanego koszyka w webshopie (BATCH_NAME / column P)
   *   @param {Object} info.buckets - Koszyki pozycji: { unavailable: [], obsolete: [], replaced: [] }
   *   @param {Array<{item: string, label: string, quantity: number}>} [info.processedItems] - Pozycje wgrane do webshopu
   */
  sendCustomerFeedback: function(info) {
    const buckets = info.buckets || { unavailable: [], obsolete: [], replaced: [] };
    const processedItems = info.processedItems || [];
    const savedCartName = String(info.savedCartName || "").trim();
    const inlineImages = {};
    const hasIssues = buckets.unavailable.length > 0 ||
      buckets.obsolete.length > 0 ||
      buckets.replaced.length > 0;

    const cartLine = savedCartName
      ? `Your order has been saved in the webshop as a saved cart named <strong style="color: #2f3941;">${savedCartName}</strong>.`
      : `Your order has been saved as a saved cart in the Webshop.`;

    let content = `
      <p style="margin: 0 0 14px 0; font-size: 16px; color: #2f3941;">Hello <strong>${info.customerName}</strong>,</p>
      <p style="margin: 0 0 18px 0; font-size: 14px; color: #4a5560; line-height: 1.6;">
        ${cartLine}
      </p>

      <div style="margin: 0 0 22px 0;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #2f3941;">Saved cart lines</h3>
        ${this.renderProcessedItemsTable(processedItems)}
      </div>
    `;

    if (hasIssues) {
      content += `
        <div style="background-color: #f7f7f7; border: 1px solid #e4e6e8; padding: 16px 18px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #2f3941;">Important notice regarding your order</h3>
          <p style="margin: 0 0 14px 0; font-size: 13px; color: #4a5560;">
            Please note the following updates regarding specific items:
          </p>
      `;

      if (buckets.replaced.length > 0) {
        const rows = buckets.replaced.slice(0, CONFIG.CUSTOMER_LIST_LIMIT).map((entry, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f7f7f7';
          return `
            <tr style="background-color: ${bg}; border-bottom: 1px solid #e4e6e8;">
              <td style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: #2f3941;">${entry.originalItem}</td>
              <td style="padding: 10px 8px; font-size: 13px; color: #6b7480; font-weight: 700;">&rarr;</td>
              <td style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: #2f3941;">${entry.currentItem}</td>
              <td style="padding: 10px 12px; font-size: 12px; color: #6b7480;">Successor item delivered</td>
            </tr>
          `;
        }).join('');

        const moreText = buckets.replaced.length > CONFIG.CUSTOMER_LIST_LIMIT 
          ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #6b7480; font-style: italic;">(+${buckets.replaced.length - CONFIG.CUSTOMER_LIST_LIMIT} more replacement items)</p>`
          : '';

        content += `
          <div style="margin-bottom: 16px;">
            <div style="font-size: 13px; font-weight: 700; color: #2f3941; margin-bottom: 8px;">
              Replaced items (we will send the succeeding items)
            </div>
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; border: 1px solid #e4e6e8;">
              <thead>
                <tr style="background-color: #3d4852;">
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: left; color: #ffffff;">Ordered Item</th>
                  <th style="padding: 10px 8px; width: 24px;"></th>
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: left; color: #ffffff;">Replacement Item</th>
                  <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: left; color: #ffffff;">Status</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            ${moreText}
          </div>
        `;
      }

      if (buckets.unavailable.length > 0) {
        content += `
          <div style="margin-bottom: 14px; background-color: #ffffff; border: 1px solid #e4e6e8; padding: 10px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #2f3941; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px;">
              Unavailable Items
            </div>
            <div>${this.renderChips(buckets.unavailable)}</div>
            <div style="font-size: 11px; color: #6b7480; margin-top: 4px;">These items could not be supplied at this time.</div>
          </div>
        `;
      }

      if (buckets.obsolete.length > 0) {
        content += `
          <div style="margin-bottom: 14px; background-color: #ffffff; border: 1px solid #e4e6e8; padding: 10px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #2f3941; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px;">
              Obsolete Items
            </div>
            <div>${this.renderChips(buckets.obsolete)}</div>
            <div style="font-size: 11px; color: #6b7480; margin-top: 4px;">These parts are discontinued.</div>
          </div>
        `;
      }

      content += `</div>`;
    }

    content += this.renderSavedCartsButton();
    content += this.signature(inlineImages);

    const emailBody = this.wrapInTemplate(content, inlineImages, {
      title: "Your HIAB saved cart is ready",
      footerNote: "Please contact your customer support representative if you have any questions."
    });

    const to = this.normalizeEmailAddress(info.customerEmail);
    if (!to) {
      throw new Error("customerEmail is missing or invalid");
    }
    const mailOptions = {
      htmlBody: emailBody,
      name: this.SENDER_NAME,
      inlineImages: inlineImages
    };
    const replyTo = this.normalizeEmailAddress(info.internalEmail) ||
      this.normalizeEmailAddress(CONFIG.TARGET_EMAIL);
    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }
    GmailApp.sendEmail(to, "Your HIAB saved cart is ready", "", mailOptions);
  }
};
