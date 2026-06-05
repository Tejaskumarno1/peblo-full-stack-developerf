import prisma from '../db.js';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { OAuth2Client } from 'google-auth-library';

// We need client secret and redirect URIs to exchange auth code for tokens
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage' // Special redirect URI for frontend auth-code flow
);

// prisma imported from db.js

export async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true, createdAt: true }
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      accessToken,
      refreshToken
    });
  } catch (error) {
    next(error);
  }
}

export async function googleLogin(req, res, next) {
  try {
    const { credential, access_token, code } = req.body;
    let email, name, sub;
    let newRefreshToken = null;

    if (code) {
      // Flow 3: Auth Code (best for offline calendar access)
      const { tokens } = await googleClient.getToken(code);
      googleClient.setCredentials(tokens);
      newRefreshToken = tokens.refresh_token;

      // Fetch user profile
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const payload = await response.json();
      if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google access token' });
      ({ email, name, sub } = payload);
    } else if (credential) {
      // Flow 1: ID Token (credential)
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google ID token' });
      ({ email, name, sub } = payload);
    } else if (access_token) {
      // Flow 2: Access Token
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      const payload = await response.json();
      if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google access token' });
      ({ email, name, sub } = payload);
    } else {
      return res.status(400).json({ error: 'Google credential, access_token, or code is required' });
    }

    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Create user if they don't exist
      const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
      const passwordHash = await bcrypt.hash(randomPassword, 12);
      
      user = await prisma.user.create({
        data: { 
          name: name || 'Google User', 
          email, 
          passwordHash,
          googleRefreshToken: newRefreshToken 
        },
        select: { id: true, name: true, email: true, createdAt: true, googleRefreshToken: true }
      });
    } else if (newRefreshToken) {
      // Update existing user with new refresh token
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleRefreshToken: newRefreshToken },
        select: { id: true, name: true, email: true, createdAt: true, googleRefreshToken: true }
      });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(401).json({ 
      error: 'Google authentication failed',
      details: error.message || String(error)
    });
  }
}

export async function me(req, res) {
  res.json({ user: req.user });
}

export async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, email: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const newAccessToken = generateAccessToken(user.id);
    res.json({ accessToken: newAccessToken, user });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}
