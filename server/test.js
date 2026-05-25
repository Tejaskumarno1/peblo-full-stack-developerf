import dotenv from 'dotenv';
console.log('Before config:', process.env.DATABASE_URL);
dotenv.config({ path: '.env' });
console.log('After config:', process.env.DATABASE_URL);
