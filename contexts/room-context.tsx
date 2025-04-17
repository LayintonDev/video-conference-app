"use client";

import type React from "react";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useAuth } from "./auth-context";
import {
  ref,
  set,
  push,
  get,
  onValue,
  remove,
  onDisconnect,
} from "firebase/database";
import { rtdb } from "@/lib/firebase";

export type Room = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  participants: Record<
    string,
    {
      displayName: string;
      joined: number;
    }
  >;
};

type RoomContextType = {
  rooms: Room[];
  createRoom: (name: string) => Promise<string>;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => void;
  currentRoom: Room | null;
  isJoiningRoom: boolean;
  joinError: string | null;
  getRoom: (roomId: string) => Promise<Room | null>;
};

const RoomContext = createContext<RoomContextType | null>(null);

export const RoomProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinInProgressRef = useRef(false);
  const joinAttemptsRef = useRef(0);
  const roomListenerRef = useRef<(() => void) | null>(null);
  const currentRoomIdRef = useRef<string | null>(null);

  // Set up room list listener
  useEffect(() => {
    if (!user) {
      setRooms([]);
      return;
    }

    console.log("Setting up rooms list listener");
    const roomsRef = ref(rtdb, "rooms");
    const unsubscribe = onValue(
      roomsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const roomsData = snapshot.val();
          const roomsList = Object.entries(roomsData).map(
            ([id, data]: [string, any]) => ({
              id,
              name: data.name,
              createdBy: data.createdBy,
              createdAt: data.createdAt,
              participants: data.participants || {},
            })
          );

          console.log(
            `Fetched ${roomsList.length} rooms from Firebase:`,
            roomsList
          );
          setRooms(roomsList);
        } else {
          console.log("No rooms found in Firebase");
          setRooms([]);
        }
      },
      (error) => {
        console.error("Error fetching rooms:", error);
      }
    );

    return () => {
      console.log("Cleaning up rooms list listener");
      unsubscribe();
    };
  }, [user]);

  // Set up current room listener
  useEffect(() => {
    // Clean up previous listener if exists
    if (roomListenerRef.current) {
      roomListenerRef.current();
      roomListenerRef.current = null;
    }

    if (!user || !currentRoomIdRef.current) {
      return;
    }

    console.log(
      `Setting up listener for current room: ${currentRoomIdRef.current}`
    );
    const roomRef = ref(rtdb, `rooms/${currentRoomIdRef.current}`);
    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const roomData = snapshot.val();
          const room: Room = {
            id: currentRoomIdRef.current!,
            name: roomData.name,
            createdBy: roomData.createdBy,
            createdAt: roomData.createdAt,
            participants: roomData.participants || {},
          };
          console.log(`Current room updated:`, room);
          setCurrentRoom(room);
        } else {
          console.log(
            `Current room ${currentRoomIdRef.current} no longer exists`
          );
          setCurrentRoom(null);
        }
      },
      (error) => {
        console.error("Error fetching current room:", error);
        setCurrentRoom(null);
      }
    );

    roomListenerRef.current = unsubscribe;
    return () => {
      if (roomListenerRef.current) {
        console.log("Cleaning up current room listener");
        roomListenerRef.current();
        roomListenerRef.current = null;
      }
    };
  }, [user, currentRoomIdRef.current]);

  // Get a room by ID
  const getRoom = async (roomId: string): Promise<Room | null> => {
    if (!roomId) {
      console.error("No room ID provided");
      return null;
    }

    try {
      console.log(`Getting room data for: ${roomId}`);
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snapshot = await get(roomRef);

      if (snapshot.exists()) {
        const roomData = snapshot.val();
        console.log(`Room data fetched for ${roomId}:`, roomData);
        return {
          id: roomId,
          name: roomData.name,
          createdBy: roomData.createdBy,
          createdAt: roomData.createdAt,
          participants: roomData.participants || {},
        };
      } else {
        console.log(`Room ${roomId} not found in database`);
        return null;
      }
    } catch (error) {
      console.error(`Error getting room ${roomId}:`, error);
      return null;
    }
  };

  const createRoom = async (name: string) => {
    if (!user) throw new Error("User not authenticated");

    console.log(`Creating new room: ${name}`);

    try {
      // Create a new room reference with a unique key
      const roomsRef = ref(rtdb, "rooms");
      const newRoomRef = push(roomsRef);
      const roomId = newRoomRef.key;

      if (!roomId) throw new Error("Failed to generate room ID");

      console.log(`Generated room ID: ${roomId}`);

      // Create the room data
      const timestamp = Date.now();
      const roomData = {
        name,
        createdBy: user.uid,
        createdAt: timestamp,
        participants: {
          [user.uid]: {
            displayName: user.displayName || "Anonymous",
            joined: timestamp,
          },
        },
      };

      // Set the room data in Firebase
      await set(newRoomRef, roomData);
      console.log(`Room data written to Firebase:`, roomData);

      // Verify the room was created by reading it back
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snapshot = await get(roomRef);

      if (!snapshot.exists()) {
        throw new Error("Room was not saved to database");
      }

      console.log(`Room verified in database:`, snapshot.val());

      // Set as current room
      currentRoomIdRef.current = roomId;
      setCurrentRoom({
        id: roomId,
        ...roomData,
      });

      return roomId;
    } catch (error) {
      console.error("Error creating room:", error);
      throw error;
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user) {
      const error = "User not authenticated";
      console.error(error);
      setJoinError(error);
      throw new Error(error);
    }

    // Prevent multiple join attempts
    if (joinInProgressRef.current) {
      console.log("Join already in progress, ignoring duplicate request");
      return;
    }

    // If we're already in this room, don't try to join again
    if (currentRoom && currentRoom.id === roomId) {
      console.log("Already in this room, no need to join again");
      return;
    }

    // Reset join error
    setJoinError(null);

    // Track join attempts to prevent infinite loops
    joinAttemptsRef.current += 1;
    if (joinAttemptsRef.current > 3) {
      const error = "Too many join attempts, aborting to prevent infinite loop";
      console.error(error);
      setJoinError(error);
      joinAttemptsRef.current = 0;
      throw new Error(error);
    }

    try {
      joinInProgressRef.current = true;
      setIsJoiningRoom(true);
      console.log(`Attempting to join room: ${roomId}`);

      // Get the room data
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snapshot = await get(roomRef);

      if (!snapshot.exists()) {
        const error = `Room ${roomId} not found in database`;
        console.error(error);
        setJoinError(error);
        throw new Error(error);
      }

      const roomData = snapshot.val();
      console.log(`Room data fetched:`, roomData);

      // Set the current room ID reference first
      currentRoomIdRef.current = roomId;

      // Add user to participants
      console.log(`Adding user ${user.uid} to room participants`);
      const participantRef = ref(
        rtdb,
        `rooms/${roomId}/participants/${user.uid}`
      );
      const participantData = {
        displayName: user.displayName || "Anonymous",
        joined: Date.now(),
      };

      await set(participantRef, participantData);
      console.log(`Participant data written:`, participantData);

      // Set up disconnect handler to remove participant when they leave
      onDisconnect(participantRef).remove();

      // Update the current room
      const room: Room = {
        id: roomId,
        name: roomData.name,
        createdBy: roomData.createdBy,
        createdAt: roomData.createdAt,
        participants: {
          ...roomData.participants,
          [user.uid]: participantData,
        },
      };

      setCurrentRoom(room);

      console.log(`Successfully joined room: ${roomId}`);
      joinAttemptsRef.current = 0;
    } catch (error: any) {
      console.error("Error joining room:", error);
      setJoinError(error.message || "Failed to join room");
      throw error;
    } finally {
      setIsJoiningRoom(false);
      // Reset the join in progress flag after a short delay
      setTimeout(() => {
        joinInProgressRef.current = false;
      }, 1000);
    }
  };

  const leaveRoom = () => {
    if (!user || !currentRoomIdRef.current) return;

    console.log(`Leaving room: ${currentRoomIdRef.current}`);
    const participantRef = ref(
      rtdb,
      `rooms/${currentRoomIdRef.current}/participants/${user.uid}`
    );
    remove(participantRef)
      .then(() => console.log("Removed participant from room"))
      .catch((err) => console.error("Error removing participant:", err));

    // Clean up the current room listener
    if (roomListenerRef.current) {
      roomListenerRef.current();
      roomListenerRef.current = null;
    }

    currentRoomIdRef.current = null;
    setCurrentRoom(null);
    joinAttemptsRef.current = 0;
  };

  return (
    <RoomContext.Provider
      value={{
        rooms,
        createRoom,
        joinRoom,
        leaveRoom,
        currentRoom,
        isJoiningRoom,
        joinError,
        getRoom,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
};

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within a RoomProvider");
  }
  return context;
};
