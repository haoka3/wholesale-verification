
"use strict";

(() => {
  const config = window.APP_CONFIG;

  const form = document.getElementById("verifyForm");
  const input = document.getElementById("customerInput");
  const button = document.getElementById("verifyButton");
  const buttonText = document.getElementById("buttonText");
  const buttonLoading = document.getElementById("buttonLoading");
  const message = document.getElementById("message");

  const registerLink = document.getElementById("registerLink");
  const noticeFrame = document.getElementById("noticeFrame");
  const noticeFallback = document.getElementById("noticeFallback");
  const noticeLink = document.getElementById("noticeLink");

  if (!config || !form || !input || !button || !message) {
    console.error("Không tìm thấy cấu hình hoặc thành phần HTML cần thiết.");
    return;
  }

  // --------------------------------------------------
  // 1. CẤU HÌNH GIAO DIỆN
  // --------------------------------------------------

  registerLink.href = config.REGISTER_FORM_URL;

  noticeFrame.src = config.NOTICE_DOC_URL;
  noticeLink.href = config.NOTICE_DOC_URL;

  noticeFrame.addEventListener("error", () => {
    noticeFallback.hidden = false;
  });

  // --------------------------------------------------
  // 2. KIỂM TRA TRẠNG THÁI ĐÃ XÁC MINH
  // --------------------------------------------------

  function isVerified() {
    try {
      const saved = localStorage.getItem(config.STORAGE_KEY);

      if (!saved) return false;

      const data = JSON.parse(saved);

      return data && data.verified === true;
    } catch (error) {
      console.warn("Không đọc được trạng thái xác minh:", error);
      return false;
    }
  }

  function saveVerification(identifier) {
    const data = {
      verified: true,
      identifier: identifier,
      verifiedAt: new Date().toISOString()
    };

    localStorage.setItem(
      config.STORAGE_KEY,
      JSON.stringify(data)
    );
  }

  function redirectToProductSearch() {
    window.location.replace(config.PRODUCT_SEARCH_URL);
  }

  if (isVerified()) {
    redirectToProductSearch();
    return;
  }

  // --------------------------------------------------
  // 3. HIỂN THỊ THÔNG BÁO
  // --------------------------------------------------

  function showMessage(text, type = "info") {
    message.textContent = text;
    message.className = `message ${type}`;
    message.hidden = false;
  }

  function hideMessage() {
    message.textContent = "";
    message.hidden = true;
  }

  function setLoading(loading) {
    button.disabled = loading;
    input.disabled = loading;

    buttonText.hidden = loading;
    buttonLoading.hidden = !loading;
  }

  // --------------------------------------------------
  // 4. CHUẨN HÓA DỮ LIỆU
  // --------------------------------------------------

  function normalizeHeader(value) {
    return String(value ?? "")
      .replace(/^\uFEFF/, "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizePhone(value) {
    return String(value ?? "")
      .replace(/^'+/, "")
      .replace(/\D/g, "");
  }

  function normalizeCustomerCode(value) {
    return String(value ?? "")
      .replace(/^'+/, "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  // --------------------------------------------------
  // 5. ĐỌC FILE CSV
  // --------------------------------------------------

  function parseCSV(text) {
    const rows = [];

    let row = [];
    let cell = "";
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (insideQuotes && next === '"') {
          cell += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        row.push(cell);
        cell = "";
      } else if (
        (char === "\n" || char === "\r") &&
        !insideQuotes
      ) {
        if (char === "\r" && next === "\n") {
          i++;
        }

        row.push(cell);

        if (row.some(value => value.trim() !== "")) {
          rows.push(row);
        }

        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    row.push(cell);

    if (row.some(value => value.trim() !== "")) {
      rows.push(row);
    }

    return rows;
  }

  // --------------------------------------------------
  // 6. TẢI VÀ XỬ LÝ GOOGLE SHEETS
  // --------------------------------------------------

  async function loadCustomerData() {
    const response = await fetch(config.SHEET_CSV_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Không tải được danh sách khách hàng (HTTP ${response.status}).`
      );
    }

    const csvText = await response.text();

    if (!csvText.trim()) {
      throw new Error("Danh sách khách hàng đang trống.");
    }

    if (
      csvText.trim().startsWith("<!DOCTYPE html") ||
      csvText.trim().startsWith("<html")
    ) {
      throw new Error(
        "Google Sheets không trả về CSV. Hãy kiểm tra quyền Publish to web."
      );
    }

    const rows = parseCSV(csvText);

    if (rows.length < 2) {
      throw new Error("Danh sách khách hàng chưa có dữ liệu.");
    }

    const headers = rows[0].map(normalizeHeader);

    const phoneIndex = headers.indexOf(
      normalizeHeader(config.PHONE_COLUMN)
    );

    const codeIndex = headers.indexOf(
      normalizeHeader(config.CUSTOMER_CODE_COLUMN)
    );

    if (phoneIndex === -1 && codeIndex === -1) {
      throw new Error(
        "Không tìm thấy cột MKH-LK hoặc Mã KH. Hãy kiểm tra tên cột trong Google Sheets."
      );
    }

    return {
      rows: rows.slice(1),
      phoneIndex,
      codeIndex
    };
  }

  // --------------------------------------------------
  // 7. TÌM KHÁCH HÀNG
  // --------------------------------------------------

  function findCustomer(identifier, customerData) {
    const phoneInput = normalizePhone(identifier);
    const codeInput = normalizeCustomerCode(identifier);

    const isPhoneInput = /^\+?[\d\s().-]+$/.test(
      String(identifier).trim()
    );

    if (isPhoneInput && phoneInput.length < 9) {
      return false;
    }

    if (!isPhoneInput && !codeInput) {
      return false;
    }

    return customerData.rows.some(row => {
      if (isPhoneInput && customerData.phoneIndex >= 0) {
        const sheetPhone = normalizePhone(
          row[customerData.phoneIndex]
        );

        if (sheetPhone && sheetPhone === phoneInput) {
          return true;
        }
      }

      if (!isPhoneInput && customerData.codeIndex >= 0) {
        const sheetCode = normalizeCustomerCode(
          row[customerData.codeIndex]
        );

        if (sheetCode && sheetCode === codeInput) {
          return true;
        }
      }

      return false;
    });
  }

  // --------------------------------------------------
  // 8. XỬ LÝ XÁC MINH
  // --------------------------------------------------

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const identifier = input.value.trim();

    hideMessage();

    if (!identifier) {
      showMessage(
        "Vui lòng nhập số điện thoại hoặc mã khách hàng.",
        "error"
      );
      input.focus();
      return;
    }

    setLoading(true);

    try {
      const customerData = await loadCustomerData();

      const matched = findCustomer(
        identifier,
        customerData
      );

      if (matched) {
        saveVerification(identifier);

        showMessage(
          "Xác minh thành công. Đang chuyển đến hệ thống...",
          "success"
        );

        setTimeout(() => {
          redirectToProductSearch();
        }, config.REDIRECT_DELAY || 700);

      } else {
        showMessage(
          "Không tìm thấy thông tin khách hàng. Vui lòng kiểm tra lại hoặc đăng ký khách hàng mới.",
          "error"
        );
      }

    } catch (error) {
      console.error("Verification error:", error);

      showMessage(
        error.message ||
        "Không thể kết nối hệ thống xác minh. Vui lòng thử lại sau.",
        "error"
      );

    } finally {
      setLoading(false);
    }
  });

})();
