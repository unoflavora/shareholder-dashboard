import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db/client';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        console.log('Auth attempt:', credentials?.email);
        
        if (!credentials?.email || !credentials?.password) {
          console.log('Missing credentials');
          return null;
        }

        try {
          const user = await db
            .select()
            .from(users)
            .where(eq(users.email, credentials.email))
            .limit(1);

          console.log('User query result:', user.length > 0 ? 'Found' : 'Not found');

          if (!user.length) {
            console.log('User not found for email:', credentials.email);
            return null;
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user[0].password
          );

          console.log('Password validation:', isPasswordValid ? 'Valid' : 'Invalid');

          if (!isPasswordValid) {
            return null;
          }

          console.log('Auth success for:', user[0].email);
          return {
            id: user[0].id.toString(),
            email: user[0].email,
            name: user[0].name,
            isAdmin: user[0].isAdmin
          };
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      }
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.isAdmin = user.isAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.isAdmin = token.isAdmin as boolean;
      }
      return session;
    }
  }
};