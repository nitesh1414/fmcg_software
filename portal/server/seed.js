// Seed an initial admin + a demo salesperson for the portal.
const bcrypt = require('bcryptjs');
const db = require('./db');

const users = [
  { name: 'Portal Admin', username: 'admin', email: 'admin@rightserve.in', phone: '', password: 'admin123', role: 'admin' },
  { name: 'Demo Salesperson', username: 'sales1', email: 'sales1@rightserve.in', phone: '', password: 'sales123', role: 'sales' },
];

const ins = db.prepare(
  'INSERT OR IGNORE INTO users (name,username,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)'
);
for (const u of users) {
  ins.run(u.name, u.username, u.email, u.phone, bcrypt.hashSync(u.password, 10), u.role);
}
console.log('Portal seeded.');
console.log('  Admin login : admin / admin123');
console.log('  Sales login : sales1 / sales123');
