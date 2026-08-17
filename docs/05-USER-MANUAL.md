# RightServe — User Manual

**RightServe — Inventory & Billing ERP**
Simple, fast, keyboard-first billing & stock for FMCG distributors and retailers.

**Support:** support@StockVeda.com · +91 86693 0888 / +91 94044 84560

---

## 1. Getting Started

### 1.1 Installing (Desktop)
1. Run the installer you received (e.g. `RightServe-Setup-1.0.0.exe`).
2. Choose the install folder (or accept the default) and finish.
3. Launch **RightServe** from the desktop/Start-menu shortcut.

> Windows may show "Unknown Publisher" until the app is code-signed — this is
> expected. Click **More info → Run anyway** if prompted.

### 1.2 Activating your license
On first launch you'll see the **Activation screen**:
1. Copy your **Machine ID** (shown on the screen) and send it to RightServe **only
   if** you were asked for a computer-locked key.
2. Paste the **license key** RightServe sent you into the box.
3. Click **Activate License**. The app starts.

If you don't have a key yet, contact RightServe (details above).

### 1.3 Logging in
- First-ever user: register a name/username/password — this account becomes the
  **Admin**.
- Demo/evaluation login: **admin / admin123**.

---

## 2. The Screen Layout

- **Top bar:** menus (Billing, Accounting, GST, Report, System), your company
  name, a **license chip** (e.g. "🛡️ 365d" or "⏳ 12d left"), theme button, and
  Logout.
- **Work area:** the current screen.
- **Right button bar:** the function keys available on this screen (F5, F8, etc.).
- **Status bar (bottom):** common shortcuts and the date/time.

### Keyboard basics (works everywhere)
| Key | Action |
|-----|--------|
| **Enter** | Move to next field / confirm |
| **Esc** | Go back to Dashboard (or close a popup) |
| **Ctrl+A** | Accept / Save the open form |
| **Ctrl+G** | Go to Dashboard |
| **Ctrl+K** | Quick stock lookup |
| **Ctrl+T** | Change theme |
| **F1** | Help & Support |
| **F12** | Configuration (feature toggles) |
| **Alt+1…5** | Jump to a section (Billing/Accounting/GST/Report/System) |

---

## 3. Setting Up Your Business

### 3.1 Company details — Settings (F11)
Enter your **business name, GSTIN, state, address, phone, email**, invoice prefix
and terms. Set the **financial-year start month** (default April).

### 3.2 Features — Configuration (F12)
Turn modules on/off to match how you work: GST columns, batch/expiry, discount,
MRP, HSN, auto round-off, allow negative stock, duplicate-serial alert, in-app
print preview, default payment mode, HSN auto-suggest, GSTIN auto-fill, etc.

### 3.3 Items / Stock master — Items (F6)
- Press **F5** to add an item: name, HSN, GST%, low-stock alert, and the
  **Units & Packaging** ladder (see below).
- With **HSN auto-suggest** on, start typing the product type and pick an HSN —
  the suggested GST rate can be applied with one click.

**Units & Packaging (Unit Conversion Engine)**
Buy in one unit and sell in another — the app keeps stock in a single **base
unit** and converts automatically.
- The first row is the **base unit** (the smallest unit you count stock in —
  e.g. *Piece*, *Bottle*, *Tablet*, *Gram*). Its conversion is always **1**.
- Add larger packaging levels with *how many base units each equals*, e.g.
  `1 Pack = 10 Piece`, `1 Box = 120 Piece`, `1 Carton = 2400 Piece`, or
  `1 Crate = 24 Bottle`, or `1 Strip = 10 Tablet, 1 Box = 15 Strip`.
- Each level can have its **own purchase price, sale price and barcode**.
- Stock always displays in readable packaging, e.g. *"1 Carton 16 Box 5 Piece"*.
- Works for any trade: FMCG, pharma, hardware, paints, agriculture, beverages…

### 3.4 Stock-in / Batches — Inventory (F7)
Add **batches** (lots) with batch/serial number, expiry, MRP, cost and quantity.
Stock is tracked **batch-wise** in **base units**, and sales issue the
**nearest-expiry batch first** (FEFO). When you purchase in Cartons/Boxes the app
converts the quantity to base units for the batch automatically.

### 3.5 Parties — Accounts (F9)
Add **customers** and **suppliers** with phone, GSTIN, state, opening balance.
- **F4** switches between Customers and Suppliers.
- Type in the **search box** to find by name/phone.
- With **GSTIN auto-fill** on, enter a GSTIN and click **Fetch** to auto-fill
  state (and name/address if an online lookup is configured).

---

## 4. Daily Billing

### 4.1 Create a Sale — Sales Voucher (F2 → F5)
1. **Customer:** start typing to search, pick a customer, or leave **Walk-in**.
   - Need a new customer? Type the name → **＋ Add new customer** → fill the quick
     form → it's created and selected, all without leaving the bill.
2. **Items:** type the product name, pick it, enter **Qty** (and rate/disc/GST if
   shown). Press **Alt+N** (or "＋ Add Row") for the next line.
3. The totals box shows Taxable, CGST, SGST, Round Off, **Grand Total**.
4. **Received:** click **Full** for full payment or type the amount; choose the
   **mode** (Cash/UPI/Bank/Cheque). **Balance** updates automatically.
5. Press **Ctrl+A** (or **Accept**) to save. Print/preview from the saved voucher.

> If stock is insufficient and "allow negative stock" is off, you'll be warned.

### 4.2 Create a Purchase — Purchase Voucher (F3 → F5)
Same flow, but you select a **Supplier** and enter **batch/serial + expiry** for
new stock. If you re-use an existing serial number, you'll get a
**duplicate-serial alert** — confirm to proceed.

### 4.3 Credit / Debit Notes
From the Sales screen use **F6 (Credit Note)** / **F7 (Debit Note)** for
financial adjustments against an earlier invoice. These **do not change stock**
and are reported in GSTR-1 (CDNR/CDNUR).

### 4.4 Receipts & Payments — (F4)
Record money **received** (in) or **paid** (out): press **F5**, search the party,
enter amount, mode and date. Party balances and ledgers update automatically.

---

## 5. Reports (F10)

Use ↑/↓ or the letter shortcuts to pick a report. Press **Ctrl+E** to export to
CSV/Excel.

> **Financial year is automatic.** The current FY is worked out from today's date
> and your **FY start month** (Settings → *Financial Year*, default **April**).
> When a new FY begins (e.g. on 1 April) reports and the dashboard **roll over on
> their own** — no manual step. You can still pick any past FY from the dropdown.

| Report | What it shows |
|--------|---------------|
| Financial Year Balance | Sales, purchases, P&L snapshot for an FY |
| GST Return (GSTR-1/3B) | Invoice-wise GST detail with B2B/B2C split |
| GSTR-1 JSON Export | File to upload on the GST portal (with validation) |
| HSN Summary | HSN-wise quantities & tax (Table 12) |
| Sales / Purchase Register | All invoices in a date range |
| GST Summary | Rate-wise tax totals |
| Batch/Serial Stock | Every batch with availability, expiry, value |
| Outstanding | Who owes you / whom you owe |
| Who-Bought/Sold (Trace) | Find every movement of a product or serial |
| Duplicate Serial Alerts | Serials used more than once (fraud/error check) |

### Filing GST
Open **GSTR-1 JSON Export**, choose the **filing month**, review the summary and
validation result, then **Download GSTR-1 JSON** and upload it on the GST portal
(Returns → GSTR-1 → Offline upload).

---

## 6. Importing Existing Data (System → Import / Migrate)

Bring data from Marg / Vyapar / Tally CSV exports:
1. Download a **template** for the entity (items/parties) if needed.
2. Upload your CSV → review the **column mapping preview**.
3. **Commit** to import.

---

## 7. Backups & Data Safety

Your data lives **only on this computer** in a single database file. Back up
regularly — especially before uninstalling.

- **In-app:** Settings → *Backup & Data* → **Backup All Data (.db)**.
- **Desktop menu:** **File → Backup All Data…** (Ctrl+B).
- **Restore:** **File → Restore From Backup…** → pick a `.db` file (replaces
  current data, then reloads).
- **Delete all:** Settings → *Backup & Data* → **Delete All Data…** (admin only,
  asks twice), or **File → Delete All Data…** on desktop.

> **Delete All Data** erases every invoice, item, party, payment, user and
> setting — but your **software licence stays activated**. The app returns to the
> first-time **create-user** screen so you can start fresh. Always take a backup
> first; this cannot be undone.

Backups are complete, consistent snapshots. Keep the `.db` file safe (USB/cloud).

Data folder (Open via **File → Open Data Folder**):
- Windows: `%APPDATA%\RightServe`
- macOS: `~/Library/Application Support/RightServe`
- Linux: `~/.config/RightServe`

---

## 8. License & Renewal

Open **System → License & Activation** (or click the license chip in the top bar)
to see: who it's licensed to, plan, issue/expiry dates, days left, and whether
it's locked to this computer.

- **15 days before expiry**, a reminder pops up at launch. Contact RightServe to
  renew in time.
- **After expiry**, the app switches to **Read-Only mode**: you can still view,
  search, print and **back up** your data, but cannot create/edit records until
  you renew. A yellow banner appears at the top.
- To renew: click **Enter / Renew License Key**, paste the new key, and the app
  restarts with full access. Your data is never affected by renewing.
- **Lifetime (perpetual)** licenses never expire and show "🛡️ Lifetime".

---

## 9. Appearance

Press **Ctrl+T** (or the palette button) to choose from 8 color themes and adjust
density/text size. Your choice is saved to your user account.

---

## 10. Tips & Shortcuts Cheat-Sheet

| Goal | Do this |
|------|---------|
| New sale fast | F2 → F5 → type product → Enter → qty → Ctrl+A |
| Add walk-in customer mid-bill | Type name in Customer box → ＋ Add new customer |
| Find a customer/supplier | F9 → type in search; F4 to switch type |
| Quick stock check | Ctrl+K anywhere |
| Toggle a feature | F12 |
| Export any report | Open report → Ctrl+E |
| See who bought a batch | F10 → Who-Bought/Sold → search serial |
| Back up now | Settings → Backup, or File → Backup (Ctrl+B) |
| Renew license | License page → Enter / Renew License Key |
| Help | F1 |

---

## 11. Frequently Asked Questions

**Q: Where is my data stored?**
Locally on this computer in one database file (see §7). It is separate from the
install folder, which is why reinstalling can show old data unless you chose to
delete it during uninstall.

**Q: I uninstalled but my data is still there after reinstalling.**
The uninstaller asks whether to delete all data. If you chose **No**, your data
was kept on purpose. Use **File → Delete All Data** to wipe it, or reinstall and
choose **Yes** at uninstall.

**Q: The app says Read-Only / License expired.**
Your license has expired. Open the License page and enter a renewed key (contact
RightServe). You can still back up your data in the meantime.

**Q: Can I move my license to another computer?**
If your key is computer-locked, contact RightServe with the new computer's
**Machine ID** (shown on the activation/License screen) for a re-issued key.

**Q: Does it need internet?**
No. RightServe runs fully offline. Internet is only needed for optional GSTIN
online lookup.

**Q: How do I get help?**
Press **F1** in the app, or contact support@StockVeda.com / +91 86693 0888.
