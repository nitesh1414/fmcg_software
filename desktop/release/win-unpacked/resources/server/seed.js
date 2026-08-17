// Seed demo data for quick testing
const bcrypt = require('bcryptjs');
const db = require('./db');

console.log('Seeding demo data...');

const tx = db.transaction(() => {
  // Reset
  db.exec(`DELETE FROM invoice_items; DELETE FROM invoices; DELETE FROM payments;
           DELETE FROM batches; DELETE FROM items; DELETE FROM categories;
           DELETE FROM parties; DELETE FROM users;`);
  // Reset AUTOINCREMENT counters so seeded ids are deterministic (1, 2, 3...)
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN
           ('users','categories','items','item_units','batches','parties','invoices','invoice_items','payments');`);

  // Admin user (with a demo security question for password recovery)
  db.prepare('INSERT INTO users (name, username, password_hash, role, sec_question, sec_answer_hash) VALUES (?,?,?,?,?,?)')
    .run('Admin', 'admin', bcrypt.hashSync('admin123', 10), 'admin',
      'What is your birth town?', bcrypt.hashSync('demo', 10));

  // Company
  db.prepare(`UPDATE company SET name=?, gstin=?, phone=?, address=?, state=?, state_code=? WHERE id=1`)
    .run('Sharma FMCG Distributors', '07ABCDE1234F1Z5', '9876543210',
         '12 Market Road, New Delhi', 'Delhi', '07');

  // Categories (multi-level hierarchy, e.g. Beverages > Soft Drinks)
  const catIds = {};
  const addCat = (name, parent) =>
    (catIds[name] = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)')
      .run(name, parent ? catIds[parent] : null).lastInsertRowid);
  // top level
  ['Beverages', 'Snacks', 'Personal Care', 'Household', 'Dairy'].forEach((c) => addCat(c, null));
  // sub levels
  addCat('Soft Drinks', 'Beverages');
  addCat('Juices', 'Beverages');
  addCat('Hair Care', 'Personal Care');
  addCat('Oral Care', 'Personal Care');

  // Items
  const items = [
    ['Cola 500ml', 'BEV001', 'Soft Drinks', 'PCS', '2202', 28, 18, 25, 24],
    ['Orange Juice 1L', 'BEV002', 'Juices', 'PCS', '2009', 12, 60, 85, 12],
    ['Potato Chips 50g', 'SNK001', 'Snacks', 'PCS', '2005', 12, 8, 10, 50],
    ['Biscuits Pack', 'SNK002', 'Snacks', 'BOX', '1905', 18, 30, 45, 20],
    ['Shampoo 200ml', 'PC001', 'Hair Care', 'PCS', '3305', 18, 90, 130, 15],
    ['Soap Bar', 'PC002', 'Personal Care', 'PCS', '3401', 18, 18, 28, 40],
    ['Detergent 1kg', 'HH001', 'Household', 'PCS', '3402', 18, 110, 150, 10],
    ['Toothpaste 100g', 'PC003', 'Oral Care', 'PCS', '3306', 18, 45, 65, 25],
    ['Milk 1L', 'DRY001', 'Dairy', 'PCS', '0401', 5, 50, 60, 30],
    ['Butter 500g', 'DRY002', 'Dairy', 'PCS', '0405', 12, 220, 270, 8],
  ];
  const itemIds = {};
  for (const [name, sku, cat, unit, hsn, gst, pp, sp, low] of items) {
    const id = db.prepare(
      `INSERT INTO items (name, sku, category_id, unit, hsn, gst_rate, purchase_price, sale_price, low_stock_alert)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(name, sku, catIds[cat], unit, hsn, gst, pp, sp, low).lastInsertRowid;
    itemIds[name] = id;
  }

  // --- Unit Conversion Engine: packaging ladders for a few demo items -------
  // factor = how many BASE units one of this unit equals (base has factor 1).
  const baseUnitOf = { 'Cola 500ml': 'Bottle', 'Biscuits Pack': 'Piece', 'Potato Chips 50g': 'Piece' };
  const unitLadders = {
    // 1 Crate = 24 Bottles; base = Bottle
    'Cola 500ml': [
      ['Bottle', 1, 18, 25, '8901000000011'],
      ['Crate', 24, 420, 600, '8901000000028'],
    ],
    // 1 Carton = 20 Boxes, 1 Box = 12 Packs, 1 Pack = 10 Pieces → base = Piece
    'Biscuits Pack': [
      ['Piece', 1, 3, 5, '8902000000010'],
      ['Pack', 10, 28, 45, '8902000000027'],
      ['Box', 120, 330, 520, '8902000000034'],       // 12 packs × 10
      ['Carton', 2400, 6400, 10200, '8902000000041'], // 20 boxes × 120
    ],
    // 1 Box = 24 Pieces; base = Piece
    'Potato Chips 50g': [
      ['Piece', 1, 8, 10, '8903000000013'],
      ['Box', 24, 180, 230, '8903000000020'],
    ],
  };
  for (const [itemName, ladder] of Object.entries(unitLadders)) {
    const id = itemIds[itemName];
    if (!id) continue;
    db.prepare('DELETE FROM item_units WHERE item_id=?').run(id);
    db.prepare('UPDATE items SET base_unit=?, unit=? WHERE id=?').run(baseUnitOf[itemName], baseUnitOf[itemName], id);
    ladder.forEach(([name, factor, pp, sp, barcode], i) => {
      db.prepare(
        `INSERT INTO item_units (item_id, unit_name, factor, is_base, purchase_price, sale_price, barcode, sort_order)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(id, name, factor, factor === 1 ? 1 : 0, pp, sp, barcode, i);
    });
  }

  // Batches (with varied expiry to demo alerts). Quantities are in BASE units.
  const today = new Date();
  const dstr = (off) => { const d = new Date(today); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
  const batches = [
    ['Cola 500ml', 'B-COLA-A', dstr(-60), dstr(120), 18, 25, 100],
    ['Cola 500ml', 'B-COLA-B', dstr(-10), dstr(15), 18, 25, 20],   // expiring soon
    ['Orange Juice 1L', 'B-OJ-1', dstr(-30), dstr(200), 60, 85, 50],
    ['Potato Chips 50g', 'B-CHIP-1', dstr(-20), dstr(40), 8, 10, 200],
    ['Biscuits Pack', 'B-BISC-1', dstr(-15), dstr(180), 30, 45, 60],
    ['Shampoo 200ml', 'B-SHM-1', dstr(-90), dstr(400), 90, 130, 40],
    ['Soap Bar', 'B-SOAP-1', dstr(-40), dstr(500), 18, 28, 150],
    ['Detergent 1kg', 'B-DET-1', dstr(-25), dstr(300), 110, 150, 5],  // low stock
    ['Toothpaste 100g', 'B-TP-1', dstr(-10), dstr(360), 45, 65, 80],
    ['Milk 1L', 'B-MILK-1', dstr(-2), dstr(5), 50, 60, 40],          // expiring very soon
    ['Butter 500g', 'B-BUT-1', dstr(-5), dstr(60), 220, 270, 15],
  ];
  for (const [item, bno, mfg, exp, pp, mrp, qty] of batches) {
    db.prepare(
      `INSERT INTO batches (item_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, qty_in, qty_available)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(itemIds[item], bno, mfg, exp, pp, mrp, qty, qty);
  }

  // Parties
  const parties = [
    ['Gupta Kirana Store', 'customer', '9811111111', '22AAAAA0000A1Z5', 'Lajpat Nagar, Delhi', 'Delhi', 0],
    ['Sunrise Supermarket', 'customer', '9822222222', '07BBBBB1111B1Z3', 'Karol Bagh, Delhi', 'Delhi', 0],
    ['Daily Needs Mart', 'customer', '9833333333', '', 'Rohini, Delhi', 'Delhi', 1500],
    ['HUL Distributors', 'supplier', '9844444444', '27CCCCC2222C1Z1', 'Mumbai', 'Maharashtra', 0],
    ['Nestle Wholesale', 'supplier', '9855555555', '24DDDDD3333D1Z9', 'Gujarat', 'Gujarat', 0],
  ];
  const partyIds = {};
  for (const [name, type, phone, gstin, addr, state, ob] of parties) {
    partyIds[name] = db.prepare(
      `INSERT INTO parties (name, type, phone, gstin, address, state, opening_balance) VALUES (?,?,?,?,?,?,?)`
    ).run(name, type, phone, gstin, addr, state, ob).lastInsertRowid;
  }

  // Ensure every item has at least a base packaging row (factor 1) so the
  // Unit Conversion Engine has a base unit for items without a custom ladder.
  for (const [name, id] of Object.entries(itemIds)) {
    const has = db.prepare('SELECT COUNT(*) c FROM item_units WHERE item_id=?').get(id).c;
    if (has === 0) {
      const it = db.prepare('SELECT unit, base_unit, purchase_price, sale_price FROM items WHERE id=?').get(id);
      const base = (it.base_unit && it.base_unit.trim()) || it.unit || 'PCS';
      db.prepare('UPDATE items SET base_unit=? WHERE id=?').run(base, id);
      db.prepare(
        `INSERT INTO item_units (item_id, unit_name, factor, is_base, purchase_price, sale_price, barcode, sort_order)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(id, base, 1, 1, it.purchase_price || 0, it.sale_price || 0, '', 0);
    }
  }

  // Initialise moving-average cost from seeded batches
  for (const id of Object.values(itemIds)) {
    const r = db.prepare('SELECT COALESCE(SUM(qty_in),0) q, COALESCE(SUM(qty_in*purchase_price),0) v FROM batches WHERE item_id=?').get(id);
    const avg = r.q > 0 ? Math.round((r.v / r.q) * 100) / 100 : 0;
    db.prepare('UPDATE items SET avg_cost=? WHERE id=?').run(avg, id);
  }

  console.log('Seeded:', { users: 1, items: items.length, batches: batches.length, parties: parties.length });
});

tx();
console.log('Done. Login -> username: admin  password: admin123');
