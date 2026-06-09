import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { OAuth2Client } from 'google-auth-library';

// We need client secret and redirect URIs to exchange auth code for tokens
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || '',
  process.env.GOOGLE_CLIENT_SECRET || '',
  'postmessage' // Special redirect URI for frontend auth-code flow
);

// prisma imported from db.js

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain uppercase, lowercase, and numbers' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true, createdAt: true, tokenVersion: true }
    });

    const accessToken = generateAccessToken(user.id, user.tokenVersion);
    const refreshToken = generateRefreshToken(user.id, user.tokenVersion);

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
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

    const accessToken = generateAccessToken(user.id, user.tokenVersion);
    const refreshToken = generateRefreshToken(user.id, user.tokenVersion);

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      accessToken,
      refreshToken
    });
  } catch (error) {
    next(error);
  }
}

export async function googleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { credential, access_token, code } = req.body;
    let email = '', name = '', sub = '';
    let newRefreshToken: string | null | undefined = null;

    if (code) {
      // Flow 3: Auth Code (best for offline calendar access)
      const { tokens } = await googleClient.getToken(code);
      googleClient.setCredentials(tokens);
      newRefreshToken = tokens.refresh_token;

      // Fetch user profile
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const payload = (await response.json()) as any;
      if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google access token' });
      email = payload.email;
      name = payload.name;
      sub = payload.sub;
    } else if (credential) {
      // Flow 1: ID Token (credential)
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID || '',
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google ID token' });
      email = payload.email;
      name = payload.name || '';
      sub = payload.sub || '';
    } else if (access_token) {
      // Flow 2: Access Token
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      const payload = (await response.json()) as any;
      if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google access token' });
      email = payload.email;
      name = payload.name;
      sub = payload.sub;
    } else {
      return res.status(400).json({ error: 'Google credential, access_token, or code is required' });
    }

    let user: any = null;
    if (sub) {
      user = await prisma.user.findUnique({ where: { googleId: sub } });
    }
    if (!user) {
      user = await prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      // Create user if they don't exist
      const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
      const passwordHash = await bcrypt.hash(randomPassword, 12);
      
      user = await prisma.user.create({
        data: { 
          name: name || 'Google User', 
          email, 
          passwordHash,
          googleRefreshToken: newRefreshToken,
          googleId: sub 
        },
        select: { id: true, name: true, email: true, createdAt: true, googleRefreshToken: true, tokenVersion: true }
      });
    } else if (newRefreshToken) {
      // Update existing user with new refresh token
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleRefreshToken: newRefreshToken },
        select: { id: true, name: true, email: true, createdAt: true, googleRefreshToken: true, tokenVersion: true }
      });
    }

    const accessToken = generateAccessToken(user.id, user.tokenVersion);
    const refreshToken = generateRefreshToken(user.id, user.tokenVersion);

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      accessToken,
      refreshToken
    });
  } catch (error: any) {
    console.error('Google login error:', error);
    res.status(401).json({ 
      error: 'Google authentication failed',
      details: error.message || String(error)
    });
  }
}

export async function me(req: Request, res: Response) {
  res.json({ user: req.user });
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken) as any;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, email: true, tokenVersion: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ error: 'Token has been invalidated' });
    }

    const newAccessToken = generateAccessToken(user.id, user.tokenVersion);
    res.json({ accessToken: newAccessToken, user });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, jobTitle, bio, timezone, settings } = req.body;
    
    // We assume authenticate middleware added req.user
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(bio !== undefined && { bio }),
        ...(timezone !== undefined && { timezone }),
        ...(settings && { settings })
      },
      select: { id: true, name: true, email: true, jobTitle: true, bio: true, timezone: true, settings: true }
    });

    if (settings) {
      const apiKeysData: any = {};
      if (settings.openAiKey !== undefined) apiKeysData.openAiKey = settings.openAiKey;
      if (settings.geminiKey !== undefined) apiKeysData.geminiKey = settings.geminiKey;
      if (settings.groqKey !== undefined) apiKeysData.groqKey = settings.groqKey;
      if (settings.huggingFaceKey !== undefined) apiKeysData.huggingFaceKey = settings.huggingFaceKey;

      if (Object.keys(apiKeysData).length > 0) {
        await prisma.userApiKeys.upsert({
          where: { userId: req.user.id },
          create: { userId: req.user.id, ...apiKeysData },
          update: apiKeysData
        });
      }
    }

    res.json({ message: 'Profile updated', user: updatedUser });
  } catch (error) {
    next(error);
  }
}

export async function updatePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { newPassword } = req.body;
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    if (newPassword.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long and contain uppercase, lowercase, and numbers' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { 
        passwordHash,
        tokenVersion: { increment: 1 } 
      }
    });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    
    // Invalidate all tokens by incrementing the tokenVersion
    await prisma.user.update({
      where: { id: req.user.id },
      data: { tokenVersion: { increment: 1 } }
    });
    
    res.json({ message: 'Successfully signed out of all other devices' });
  } catch (error) {
    next(error);
  }
}

export async function linkGoogle(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.body;
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    if (!code) return res.status(400).json({ error: 'Auth code required' });

    const { tokens } = await googleClient.getToken(code);
    
    // Fetch user profile to get googleId (sub)
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const payload = (await response.json()) as any;
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Failed to retrieve Google profile' });
    }

    const newRefreshToken = tokens.refresh_token;

    await prisma.user.update({
      where: { id: req.user.id },
      data: { 
        googleId: payload.sub,
        ...(newRefreshToken && { googleRefreshToken: newRefreshToken })
      }
    });

    res.json({ message: 'Google account linked successfully' });
  } catch (error: any) {
    console.error('Google link error:', error);
    res.status(500).json({ error: 'Failed to link Google account', details: error.message });
  }
}
