"use client";

import type React from "react";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useAuth } from "./auth-context";
import { ref, onValue, push } from "firebase/database";
import { rtdb } from "@/lib/firebase";

type Message = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
};

type ChatContextType = {
  messages: Message[];
  sendMessage: (text: string) => Promise<void>;
  roomId: string | null;
  setRoomId: (roomId: string | null) => void;
};

const ChatContext = createContext<ChatContextType | null>(null);

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const messagesListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Clean up previous listener if exists
    if (messagesListenerRef.current) {
      messagesListenerRef.current();
      messagesListenerRef.current = null;
    }

    if (!roomId) {
      setMessages([]);
      return;
    }

    console.log(`Setting up messages listener for room: ${roomId}`);
    const messagesRef = ref(rtdb, `rooms/${roomId}/messages`);
    const unsubscribe = onValue(
      messagesRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const messagesData = snapshot.val();
          const messagesList = Object.entries(messagesData).map(
            ([id, data]: [string, any]) => ({
              id,
              userId: data.userId,
              userName: data.userName,
              text: data.text,
              timestamp: data.timestamp,
            })
          );

          // Sort messages by timestamp
          messagesList.sort((a, b) => a.timestamp - b.timestamp);
          console.log(
            `Fetched ${messagesList.length} messages for room ${roomId}`
          );
          setMessages(messagesList);
        } else {
          console.log(`No messages found for room ${roomId}`);
          setMessages([]);
        }
      },
      (error) => {
        console.error("Error fetching messages:", error);
      }
    );

    messagesListenerRef.current = unsubscribe;
    return () => {
      if (messagesListenerRef.current) {
        console.log("Cleaning up messages listener");
        messagesListenerRef.current();
        messagesListenerRef.current = null;
      }
    };
  }, [roomId]);

  const sendMessage = async (text: string) => {
    if (!user || !roomId || !text.trim()) return;

    try {
      console.log(`Sending message to room ${roomId}`);
      const messagesRef = ref(rtdb, `rooms/${roomId}/messages`);
      await push(messagesRef, {
        userId: user.uid,
        userName: user.displayName || "Anonymous",
        text,
        timestamp: Date.now(),
      });
      console.log("Message sent successfully");
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  return (
    <ChatContext.Provider value={{ messages, sendMessage, roomId, setRoomId }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};
