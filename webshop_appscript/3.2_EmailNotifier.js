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

  // =======================================================================================
  // 1. STAŁE KONFIGURACYJNE I STATUSY
  // =======================================================================================

  // ID folderu na Google Drive z oficjalnym logo HIAB
  LOGO_FOLDER_ID: "1Ry0zPOQdTPAu10jXfK9MBWoqkr1kw7KM",
  
  // Nazwa pliku graficznego z logo tekstowym HIAB w folderze na Drive
  LOGO_FILE_NAME: "hiab-text-logo.png",
  
  // Nazwa nadawcy wyświetlana odbiorcom w programach pocztowych
  SENDER_NAME: "Hiab Deals Automation",

  // Warianty statusów powiadomień wewnętrznych dla operatora zgłaszającego plik:
  VARIANTS: {
    VALID: "VALID",                 // Plik zweryfikowany pomyślnie, oczekuje na wgranie przez robota
    FATAL: "FATAL",                 // Błąd krytyczny pliku (zły format, brak wymaganych kolumn)
    REJECTED: "REJECTED",           // Pozycje nie przeszły walidacji biznesowej / BigQuery / dane klienta
    UPLOAD_FAILED: "UPLOAD_FAILED"  // Walidacja poprawna, lecz robot uległ awarii przy tworzeniu koszyka
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
        const folder = DriveApp.getFolderById(this.LOGO_FOLDER_ID);
        const files = folder.getFilesByName(this.LOGO_FILE_NAME);
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
      <div style="margin-top: 26px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;">Best regards,</p>
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 700; color: #1e293b;">${this.SENDER_NAME}</p>
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
      <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 28px; text-align: center;">
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b;">
          <strong>HIAB Deals Automation System</strong> &bull; This is an automated notification.<br>
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
      return '<span style="color: #94a3b8; font-style: italic;">None</span>';
    }

    const chips = names.slice(0, max).map(code => 
      `<span style="display: inline-block; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 11px; font-weight: 600; background-color: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; margin: 2px 3px 2px 0; letter-spacing: 0.3px;">${code}</span>`
    ).join('');

    const more = names.length > max
      ? `<span style="display: inline-block; font-size: 11px; color: #64748b; font-style: italic; margin-left: 4px;">(+${names.length - max} more)</span>`
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
   * Renderuje dwukolumnową tabelę z metadanymi zamówienia
   * (plik nadesłany, konto klienta, adres powiadomień) z naprzemiennym tłem wierszy.
   * 
   * @param {Array<{label: string, value: string}>} items - Lista par etykieta/wartość
   * @returns {string} Kod HTML tabeli metadanych
   */
  renderMetadataTable: function(items) {
    const rows = items.map((item, index) => {
      const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      return `
        <tr style="background-color: ${bg};">
          <td style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; width: 34%; border-bottom: 1px solid #edf2f7;">${item.label}</td>
          <td style="padding: 9px 14px; font-size: 13px; font-weight: 500; color: #0f172a; border-bottom: 1px solid #edf2f7;">${item.value}</td>
        </tr>
      `;
    }).join('');

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin: 16px 0 18px 0;">
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
      <td align="center" style="padding: 4px; width: ${Math.floor(100 / stats.length)}%;">
        <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
          <div style="font-size: 24px; font-weight: 800; color: ${stat.color || '#1e293b'}; line-height: 1;">${stat.value}</div>
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; margin-top: 6px;">${stat.label}</div>
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
   * Posiada zaokrąglone tło, akcentowy pasek po lewej stronie, pigułkę z etykietą oraz opis.
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
        bannerBg: "#f0fdf4"
      },
      [this.VARIANTS.REJECTED]: {
        badge: "VALIDATION FAILED",
        badgeColor: "#991b1b",
        title: "Order File Rejected",
        desc: "Items failed validation checks. The entire file was rejected and will not be uploaded.",
        bannerBg: "#fef2f2"
      },
      [this.VARIANTS.FATAL]: {
        badge: "FATAL ERROR",
        badgeColor: "#9f1239",
        title: "File Processing Failed",
        desc: "The uploaded file could not be processed due to a structural or format error.",
        bannerBg: "#fff1f2"
      },
      [this.VARIANTS.UPLOAD_FAILED]: {
        badge: "ROBOT UPLOAD FAILED",
        badgeColor: "#92400e",
        title: "Webshop Upload Error",
        desc: "Validation passed, but the automation robot failed to complete the cart in the webshop.",
        bannerBg: "#fffbeb"
      },
      CUSTOMER_COMPLETED: {
        badge: "ORDER COMPLETED",
        badgeColor: "#15803d",
        title: "Order Processed Successfully",
        desc: "We have finished processing your webshop order.",
        bannerBg: "#f0fdf4"
      }
    };

    const cfg = configs[variant] || configs[this.VARIANTS.VALID];

    return `
      <div style="background-color: ${cfg.bannerBg}; border-radius: 6px; padding: 14px 18px; margin: 14px 0 18px 0; line-height: 1.5;">
        <div style="font-weight: 700; font-size: 13px; color: ${cfg.badgeColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
          ${cfg.badge}
        </div>
        <div style="font-size: 13px; color: #1e293b; font-weight: 600; margin-bottom: 2px;">
          ${cfg.title}
        </div>
        <div style="font-size: 13px; color: #475569;">
          ${cfg.desc}
        </div>
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
      const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      const warningText = entry.warning 
        ? `<span style="color: #dc2626; font-weight: 600; font-size: 12px;">${entry.warning}</span>`
        : '<span style="color: #94a3b8; font-size: 11px;">None</span>';

      return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #edf2f7;">
          <td style="padding: 10px 12px; font-size: 12px;">
            <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-weight: 600; color: #1e293b;">${entry.originalItem}</span>
          </td>
          <td style="padding: 10px 12px; font-size: 12px;">
            <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-weight: 700; color: #0369a1;">${entry.currentItem}</span>
          </td>
          <td style="padding: 10px 12px; font-size: 12px; color: #475569;">${entry.chain}</td>
          <td style="padding: 10px 12px; font-size: 12px;">${warningText}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin: 10px 0 18px 0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; font-size: 12px; text-align: left;">
          <thead>
            <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
              <th style="padding: 9px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Ordered Item</th>
              <th style="padding: 9px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Processed Item</th>
              <th style="padding: 9px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Replacement Chain</th>
              <th style="padding: 9px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Warning</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
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
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      return `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #edf2f7;">
          <td style="padding: 10px 14px; vertical-align: top; width: 36%;">
            <div style="font-weight: 700; color: #991b1b; font-size: 12px;">${sec.label}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${sec.entries.length} ${sec.entries.length === 1 ? 'item' : 'items'}</div>
          </td>
          <td style="padding: 10px 14px; vertical-align: top;">
            ${this.renderChips(sec.entries, 50)}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div style="border: 1px solid #fecaca; border-radius: 8px; overflow: hidden; margin: 10px 0 18px 0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background-color: #fee2e2; border-bottom: 1px solid #fca5a5;">
              <th style="padding: 9px 14px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #991b1b; text-align: left;">Category</th>
              <th style="padding: 9px 14px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #991b1b; text-align: left;">Rejected Items</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
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
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f4f6f9; width: 100% !important; margin: 0; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Główna karta wiadomości -->
        <table cellpadding="0" cellspacing="0" border="0" width="620" style="max-width: 620px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);">
          
          <!-- Górny pasek akcentowy marki HIAB -->
          <tr>
            <td style="height: 4px; background-color: #D52B1E; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Nagłówek wiadomości z logo -->
          <tr>
            <td style="padding: 20px 28px; border-bottom: 1px solid #f1f5f9;">
              ${logoHtml}
            </td>
          </tr>

          <!-- Właściwa zawartość e-maila -->
          <tr>
            <td style="padding: 24px 28px 28px 28px; font-size: 14px; line-height: 1.5; color: #1e293b;">
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
      <p style="margin: 0 0 14px 0; font-size: 15px; color: #0f172a;">Hello <strong>${info.internalName}</strong>,</p>
      <p style="margin: 0 0 14px 0; font-size: 13px; color: #475569;">Here is the automated processing overview for file <strong>${info.attachmentName}</strong> (Customer: <strong>${customerLine}</strong>).</p>
    `;

    // Status Banner
    content += this.renderStatusBanner(info.variant);

    // KPI row for validation results
    if (info.variant === this.VARIANTS.VALID || info.variant === this.VARIANTS.REJECTED || info.variant === this.VARIANTS.UPLOAD_FAILED) {
      content += this.renderKpiCards([
        { label: "Total Items", value: report.total, color: "#334155" },
        { label: "Passed", value: (report.ready || []).length, color: "#FF7C43" },
        { label: "Rejected", value: report.rejectedCount || 0, color: (report.rejectedCount > 0 ? "#dc2626" : "#64748b") },
        { label: "Replaced", value: (report.replaced || []).length, color: "#0E2532" }
      ]);
    }

    // Variant-specific details
    if (info.variant === this.VARIANTS.FATAL) {
      content += `
        <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
          <div style="font-weight: 700; color: #9f1239; font-size: 13px; margin-bottom: 4px;">Reason for Failure</div>
          <div style="font-size: 13px; color: #881337;">${info.errorMessage}</div>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
          <div style="font-weight: 700; color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Required File Layout</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 12px; color: #475569;">
            <tr><td style="padding: 3px 0; width: 28px;"><strong>A:</strong></td><td>Item Number (Material code)</td></tr>
            <tr><td style="padding: 3px 0;"><strong>B:</strong></td><td>Order Amount (Quantity)</td></tr>
            <tr><td style="padding: 3px 0;"><strong>C:</strong></td><td>Customer ID</td></tr>
            <tr><td style="padding: 3px 0;"><strong>D:</strong></td><td>Customer Name</td></tr>
            <tr><td colspan="2" style="padding-top: 6px; font-size: 11px; color: #94a3b8;">* Row 1 is reserved for column headers.</td></tr>
          </table>
        </div>

        <p style="margin: 16px 0 0 0; font-size: 13px; color: #475569;">
          Please correct the file structure according to the specifications above and resubmit it to <a href="mailto:${CONFIG.TARGET_EMAIL}" style="color: #D52B1E; font-weight: 600; text-decoration: none;">${CONFIG.TARGET_EMAIL}</a>.
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
            <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #480011;">Items that will not be uploaded (Action Required):</h3>
            ${rejected}
          </div>
        `;
      }

      if (report.replaced && report.replaced.length > 0) {
        content += `
          <div style="margin-top: 18px;">
            <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #0E2532;">Replaced items (successor resolved, would be uploaded):</h3>
            ${this.replacementTable(report.replaced)}
          </div>
        `;
      }

      content += `
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 18px; margin-top: 18px;">
          <div style="font-weight: 700; color: #991b1b; font-size: 13px;">Submission Notice</div>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #7f1d1d; line-height: 1.4;">
            The entire file was rejected and nothing was uploaded to the webshop.<br>
            Please review the rejected items above, correct the file in the system, and resubmit.
          </p>
        </div>
      `;
    }
    else if (info.variant === this.VARIANTS.UPLOAD_FAILED) {
      content += `
        <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
          <div style="font-weight: 700; color: #9f1239; font-size: 13px; margin-bottom: 4px;">Upload Error Reason</div>
          <div style="font-size: 13px; color: #881337;">${info.errorMessage}</div>
        </div>

        <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
          <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.4;">
            The file passed validation (<strong>${report.ready.length}</strong> of <strong>${report.total}</strong> items were ready for upload), but the automation robot could not finalize the webshop cart.
            <br><br>
            <strong>Note:</strong> The customer has <strong>NOT</strong> been notified.
            <br>
            Please check the webshop session and retry the upload.
          </p>
        </div>
      `;
    }
    else {
      // VALID
      if (report.replaced && report.replaced.length > 0) {
        content += `
          <div style="margin-top: 18px;">
            <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #0369a1;">Replaced items (successors will be uploaded):</h3>
            ${this.replacementTable(report.replaced)}
          </div>
        `;
      }

      content += `
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin-top: 18px;">
          <div style="font-weight: 700; color: #166534; font-size: 13px;">Automatic Process in Progress</div>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #14532d; line-height: 1.4;">
            No operator action required. The automation robot will upload this file to the webshop.
            ${info.customerEmail ? `<br>Customer notification will be sent automatically to: <strong>${info.customerEmail}</strong>.` : ''}
          </p>
        </div>
      `;
    }

    content += this.signature(inlineImages);

    const emailBody = this.wrapInTemplate(content, inlineImages, {
      title: "Hiab Deals Submission Overview",
      footerNote: "Please do not reply directly to this notification email."
    });

    message.reply("", {
      htmlBody: emailBody,
      name: this.SENDER_NAME,
      inlineImages: inlineImages
    });
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
   *   @param {string} info.attachmentName - Identyfikator / nazwa pliku zamówienia
   *   @param {string} [info.internalEmail] - Opcjonalny adres reply-to do przedstawiciela HIAB
   *   @param {Object} info.buckets - Koszyki pozycji: { unavailable: [], obsolete: [], replaced: [] }
   */
  sendCustomerFeedback: function(info) {
    const buckets = info.buckets || { unavailable: [], obsolete: [], replaced: [] };
    const inlineImages = {};
    const hasIssues = buckets.unavailable.length > 0 ||
      buckets.obsolete.length > 0 ||
      buckets.replaced.length > 0;

    let content = `
      <p style="margin: 0 0 14px 0; font-size: 15px; color: #0f172a;">Dear <strong>${info.customerName}</strong>,</p>
      <p style="margin: 0 0 14px 0; font-size: 14px; color: #334155; line-height: 1.5;">
        Thank you for your order. We are pleased to confirm that your order (reference: <strong>${info.attachmentName}</strong>) has been processed.
      </p>
    `;

    // Status Banner
    content += this.renderStatusBanner('CUSTOMER_COMPLETED');

    // Order Overview
    content += this.renderMetadataTable([
      { label: "Order Reference", value: `<strong style="color: #0f172a;">${info.attachmentName}</strong>` },
      { label: "Account Name", value: info.customerName },
      { label: "Status", value: '<span style="color: #16a34a; font-weight: 700;">Completed in Webshop</span>' }
    ]);

    if (hasIssues) {
      content += `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #1e293b;">Important Notice Regarding Your Order</h3>
          <p style="margin: 0 0 14px 0; font-size: 13px; color: #475569;">
            Your order has been completed, but please note the following updates regarding specific items:
          </p>
      `;

      if (buckets.replaced.length > 0) {
        const rows = buckets.replaced.slice(0, CONFIG.CUSTOMER_LIST_LIMIT).map((entry, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          return `
            <tr style="background-color: ${bg}; border-bottom: 1px solid #edf2f7;">
              <td style="padding: 8px 12px; font-size: 12px;"><span style="font-family: monospace; font-weight: 600; color: #334155;">${entry.originalItem}</span></td>
              <td style="padding: 8px 12px; font-size: 12px; color: #0284c7; font-weight: 700;">&rarr;</td>
              <td style="padding: 8px 12px; font-size: 12px;"><span style="font-family: monospace; font-weight: 700; color: #0369a1;">${entry.currentItem}</span></td>
              <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">Successor item delivered</td>
            </tr>
          `;
        }).join('');

        const moreText = buckets.replaced.length > CONFIG.CUSTOMER_LIST_LIMIT 
          ? `<p style="margin: 6px 0 0 0; font-size: 11px; color: #64748b; font-style: italic;">(+${buckets.replaced.length - CONFIG.CUSTOMER_LIST_LIMIT} more replacement items)</p>`
          : '';

        content += `
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
              Replaced Items (we will send the succeeding items):
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; font-size: 12px;">
                <thead>
                  <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
                    <th style="padding: 7px 12px; font-size: 11px; font-weight: 700; text-align: left; color: #475569;">Ordered Item</th>
                    <th style="padding: 7px 12px; width: 24px;"></th>
                    <th style="padding: 7px 12px; font-size: 11px; font-weight: 700; text-align: left; color: #475569;">Replacement Item</th>
                    <th style="padding: 7px 12px; font-size: 11px; font-weight: 700; text-align: left; color: #475569;">Status</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ${moreText}
          </div>
        `;
      }

      if (buckets.unavailable.length > 0) {
        content += `
          <div style="margin-bottom: 14px; background-color: #ffffff; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
              Unavailable Items:
            </div>
            <div>${this.renderChips(buckets.unavailable)}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">These items could not be supplied at this time.</div>
          </div>
        `;
      }

      if (buckets.obsolete.length > 0) {
        content += `
          <div style="margin-bottom: 14px; background-color: #ffffff; border: 1px solid #fed7aa; border-radius: 6px; padding: 10px 14px;">
            <div style="font-size: 12px; font-weight: 700; color: #c2410c; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
              Obsolete Items:
            </div>
            <div>${this.renderChips(buckets.obsolete)}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">These parts are discontinued.</div>
          </div>
        `;
      }

      content += `
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #64748b;">
            If you have any questions regarding these items, please contact your customer support representative.
          </p>
        </div>
      `;
    }

    content += `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-top: 18px;">
        <div style="font-weight: 700; color: #334155; font-size: 13px;">Customer Support</div>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.4;">
          Need assistance or wish to enquire about your delivery? Please reply to this email or contact your assigned HIAB representative.
        </p>
      </div>
    `;

    content += this.signature(inlineImages);

    const emailBody = this.wrapInTemplate(content, inlineImages, {
      title: "Your HIAB order has been completed",
      footerNote: "Please contact your customer support representative if you have any questions."
    });

    GmailApp.sendEmail(info.customerEmail, "Your HIAB order has been completed", "", {
      htmlBody: emailBody,
      name: this.SENDER_NAME,
      replyTo: info.internalEmail || CONFIG.TARGET_EMAIL,
      inlineImages: inlineImages
    });
  }
};
