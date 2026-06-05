import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '7d';

export function generateAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}
