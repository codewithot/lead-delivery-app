import bcrypt from 'bcryptjs';

const password = 'YourNewPassword123!'; // Change this to your desired password

// Use 12 rounds to match your register.ts
const hash = bcrypt.hashSync(password, 12);

console.log('Password:', password);
console.log('\nHashed password (copy this):');
console.log(hash);

$2b$12$AYF1QF6.gG7L9Tc9H7IoK.Q5ekYkLvXebJY1rV9Y4tP6l0.EnmGrm



