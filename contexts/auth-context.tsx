"use client";

import type React from "react";

import { createContext, useContext, useEffect, useState } from "react";
import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  getIdToken,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  useFirebaseTokenCookie,
  setTokenCookie,
  removeTokenCookie,
} from "@/lib/cookies";

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Use the token cookie hook
  useFirebaseTokenCookie();

  useEffect(() => {
    console.log("Auth provider initializing");
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log("Auth state changed:", user ? "User logged in" : "No user");

      if (user) {
        // Immediately set the token cookie when user is available
        try {
          const token = await getIdToken(user, true); // Force refresh the token
          setTokenCookie(token);
          console.log("Token set in cookie");
        } catch (error) {
          console.error("Error getting token:", error);
        }
      } else {
        // Clear the token cookie when no user
        removeTokenCookie();
        console.log("Token removed from cookie");
      }

      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Update the signUp function to better handle errors
  const signUp = async (
    email: string,
    password: string,
    displayName: string
  ) => {
    try {
      console.log("Starting signup process...");
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      console.log("User created successfully, updating profile...");
      await updateProfile(userCredential.user, { displayName });
      console.log("Profile updated successfully");

      // Set token immediately after signup
      const token = await getIdToken(userCredential.user, true);
      setTokenCookie(token);

      setUser(userCredential.user);
    } catch (error) {
      console.error("Error during signup:", error);
      throw error; // Re-throw to handle in the component
    }
  };

  // Update the signIn function to better handle errors
  const signIn = async (email: string, password: string) => {
    try {
      console.log("Starting signin process...");
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      console.log("Signed in successfully");

      // Set token immediately after signin
      const token = await getIdToken(userCredential.user, true);
      setTokenCookie(token);
    } catch (error) {
      console.error("Error during signin:", error);
      throw error; // Re-throw to handle in the component
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      removeTokenCookie();
      setUser(null);
    } catch (error) {
      console.error("Error during signout:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
