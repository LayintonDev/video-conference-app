"use client";

import { auth } from "./firebase";
import { onIdTokenChanged } from "firebase/auth";
import Cookies from "js-cookie";
import { useEffect } from "react";

// Set the token in a cookie
export const setTokenCookie = (token: string) => {
  if (!token) {
    console.error("Attempted to set empty token");
    return;
  }

  console.log("Setting token cookie");
  Cookies.set("firebase-token", token, {
    expires: 14, // 14 days
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
};

// Remove the token cookie
export const removeTokenCookie = () => {
  console.log("Removing token cookie");
  Cookies.remove("firebase-token", { path: "/" });
};

// Get the token from cookies
export const getTokenCookie = () => {
  return Cookies.get("firebase-token");
};

// Hook to handle token changes
export const useFirebaseTokenCookie = () => {
  useEffect(() => {
    console.log("Setting up token change listener");
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken();
          setTokenCookie(token);
          console.log("Token updated in cookie from change listener");
        } catch (error) {
          console.error("Error getting token in change listener:", error);
        }
      } else {
        removeTokenCookie();
        console.log("Token removed from cookie in change listener");
      }
    });

    return () => {
      console.log("Cleaning up token change listener");
      unsubscribe();
    };
  }, []);
};
