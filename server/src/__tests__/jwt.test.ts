import { generateAccessToken, verifyAccessToken } from '../utils/jwt.js';

describe('JWT Utilities', () => {
  it('should generate a valid access token containing the userId and tokenVersion', () => {
    const userId = 'user-123';
    const tokenVersion = 1;
    
    const token = generateAccessToken(userId, tokenVersion);
    expect(typeof token).toBe('string');
    
    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(userId);
    expect(decoded.tokenVersion).toBe(tokenVersion);
  });
});
