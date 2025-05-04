"use client";

import type React from "react";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import { useAuth } from "./auth-context";
import {
  ref,
  onValue,
  set,
  remove,
  onDisconnect,
  push,
  get,
} from "firebase/database";
import { rtdb, storage } from "@/lib/firebase";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { Room } from "./room-context";

type Peer = {
  id: string;
  displayName: string;
  stream?: MediaStream;
  connection?: RTCPeerConnection;
};

type WebRTCContextType = {
  localStream: MediaStream | null;
  peers: Peer[];
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isRecording: boolean;
  toggleAudio: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  joinRoom: (roomId: string, currentRoom: Room | null) => Promise<void>;
  leaveRoom: () => void;
  currentRoomId: string | null;
  // currentRoom: Room | null;
  recordingURL: string | null;
  webRTCError: string | null;
  clearWebRTCError: () => void;
  isScreenShareSupported: boolean;
  reinitializeMedia: () => Promise<boolean>;
  mediaState: {
    hasVideo: boolean;
    hasAudio: boolean;
    videoDevices: MediaDeviceInfo[];
    audioDevices: MediaDeviceInfo[];
    selectedVideoDevice: string | null;
    selectedAudioDevice: string | null;
  };
  setSelectedVideoDevice: (deviceId: string) => void;
  setSelectedAudioDevice: (deviceId: string) => void;
  reconnectPeers: (roomId: string) => Promise<void>;
  connectionStatus: "connecting" | "connected" | "disconnected" | "failed";
};

const WebRTCContext = createContext<WebRTCContextType | null>(null);

// Enhanced ICE server configuration with more STUN/TURN servers for better connectivity
const configuration: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "balanced",
  rtcpMuxPolicy: "require",
  iceTransportPolicy: "all",
};

export const WebRTCProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [recordingURL, setRecordingURL] = useState<string | null>(null);
  const [webRTCError, setWebRTCError] = useState<string | null>(null);
  const [isScreenShareSupported, setIsScreenShareSupported] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string | null>(
    null
  );
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string | null>(
    null
  );
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected" | "failed"
  >("disconnected");

  const screenShareStream = useRef<MediaStream | null>(null);
  const originalStream = useRef<MediaStream | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const joinAttemptedRef = useRef(false);
  const joinAttemptsRef = useRef(0);
  const listenersSetupRef = useRef(false);
  const participantsUnsubscribeRef = useRef<(() => void) | null>(null);
  const offersUnsubscribeRef = useRef<(() => void) | null>(null);
  const answersUnsubscribeRef = useRef<(() => void) | null>(null);
  const candidatesUnsubscribeRef = useRef<(() => void) | null>(null);
  const mediaInitAttempts = useRef(0);
  const connectionCheckInterval = useRef<NodeJS.Timeout | null>(null);

  // Enumerate media devices
  const enumerateDevices = async () => {
    try {
      console.log("Enumerating media devices...");
      const devices = await navigator.mediaDevices.enumerateDevices();

      // Filter video devices
      const videoInputs = devices.filter(
        (device) => device.kind === "videoinput"
      );
      setVideoDevices(videoInputs);
      console.log(`Found ${videoInputs.length} video devices:`, videoInputs);

      // Filter audio devices
      const audioInputs = devices.filter(
        (device) => device.kind === "audioinput"
      );
      setAudioDevices(audioInputs);
      console.log(`Found ${audioInputs.length} audio devices:`, audioInputs);

      // Set default devices if not already set
      if (videoInputs.length > 0 && !selectedVideoDevice) {
        setSelectedVideoDevice(videoInputs[0].deviceId);
      }

      if (audioInputs.length > 0 && !selectedAudioDevice) {
        setSelectedAudioDevice(audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error("Error enumerating devices:", error);
    }
  };

  // Initialize devices on component mount
  useEffect(() => {
    enumerateDevices();

    // Set up device change listener
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        enumerateDevices
      );
    };
  }, []);

  // Check if screen sharing is supported
  useEffect(() => {
    const checkScreenSharing = () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) {
        setIsScreenShareSupported(false);
        return;
      }

      // Check if getDisplayMedia is available
      if (!navigator.mediaDevices.getDisplayMedia) {
        console.log("Screen sharing is not supported in this browser");
        setIsScreenShareSupported(false);
        return;
      }

      // Check if we're in a secure context (HTTPS)
      if (
        typeof window !== "undefined" &&
        window.location.protocol !== "https:"
      ) {
        // In development or non-secure environments, we'll assume it might work
        if (process.env.NODE_ENV === "development") {
          console.log(
            "Screen sharing might work in development, but requires HTTPS in production"
          );
          setIsScreenShareSupported(true);
        } else {
          console.log("Screen sharing requires HTTPS");
          setIsScreenShareSupported(false);
        }
        return;
      }

      setIsScreenShareSupported(true);
    };

    checkScreenSharing();
  }, []);

  // Reconnect peers
  const reconnectPeers = async (roomId: string) => {
    console.log("Reconnecting to peers...", {
      roomId,
      user,
      localStream,
    });
    if (!roomId || !user || !localStream) {
      console.log("Cannot reconnect peers: missing required data");
      return;
    }

    setConnectionStatus("connecting");
    console.log("Reconnecting to peers...");

    try {
      // Close existing connections
      Object.values(peerConnections.current).forEach((pc) => {
        pc.close();
      });
      peerConnections.current = {};

      // Keep existing peer structure but clear streams
      setPeers((prevPeers) =>
        prevPeers.map((peer) => ({
          ...peer,
          stream: undefined,
          connection: undefined,
        }))
      );

      // Clean up existing signaling data
      await cleanupSignalingData(roomId, user.uid);

      // Wait a moment for cleanup to propagate
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Re-setup WebRTC listeners if they were cleaned up
      if (!listenersSetupRef.current) {
        const roomRef = ref(rtdb, `rooms/${roomId}`);
        const snapshot = await get(roomRef);
        if (snapshot.exists()) {
          const roomData = snapshot.val();
          const currentRoom: Room = {
            id: roomId,
            name: roomData.name,
            createdBy: roomData.createdBy,
            createdAt: roomData.createdAt,
            participants: roomData.participants || {},
          };
          setupWebRTCListeners(roomId, currentRoom);
        } else {
          throw new Error("Room not found");
        }
      }

      // Refresh local media stream tracks in case of disconnection
      const refreshedStream = await reinitializeMedia();
      if (!refreshedStream) {
        console.log("Failed to refresh media, continuing with existing stream");
      }

      // Get current participants
      const participantsRef = ref(rtdb, `rooms/${roomId}/participants`);
      const snapshot = await get(participantsRef);

      if (snapshot.exists()) {
        const participants = snapshot.val();
        console.log(
          `Found ${Object.keys(participants).length} participants in room`
        );

        // Create new connections to all participants except self
        Object.entries(participants).forEach(
          ([id, participant]: [string, any]) => {
            if (id !== user.uid) {
              console.log(`Creating new connection to participant: ${id}`);
              createPeerConnection(id, roomId, true);

              setPeers((prevPeers) => {
                if (!prevPeers.some((p) => p.id === id)) {
                  return [
                    ...prevPeers,
                    {
                      id,
                      displayName: participant.displayName,
                    },
                  ];
                }
                return prevPeers;
              });
            }
          }
        );

        setConnectionStatus("connected");
      } else {
        console.log("No participants found in room");
        setConnectionStatus("disconnected");
      }
    } catch (error) {
      console.error("Error reconnecting to peers:", error);
      setWebRTCError("Failed to reconnect to peers. Please try again.");
      setConnectionStatus("failed");
    }
  };

  // Clean up old signaling data
  const cleanupSignalingData = async (roomId: string, userId: string) => {
    try {
      console.log(
        `Cleaning up signaling data for room ${roomId} and user ${userId}`
      );

      // Clean up old offers
      const offersRef = ref(rtdb, `rooms/${roomId}/offers/${userId}`);
      await remove(offersRef);

      // Also clean up offers to this user from other participants
      const allOffersRef = ref(rtdb, `rooms/${roomId}/offers`);
      const offersSnapshot = await get(allOffersRef);
      if (offersSnapshot.exists()) {
        const offers = offersSnapshot.val();
        for (const [senderId, senderOffers] of Object.entries(offers)) {
          if (senderId !== userId) {
            const offerToUserRef = ref(
              rtdb,
              `rooms/${roomId}/offers/${senderId}/${userId}`
            );
            await remove(offerToUserRef);
          }
        }
      }

      // Clean up old answers
      const answersRef = ref(rtdb, `rooms/${roomId}/answers/${userId}`);
      await remove(answersRef);

      // Also clean up answers to this user from other participants
      const allAnswersRef = ref(rtdb, `rooms/${roomId}/answers`);
      const answersSnapshot = await get(allAnswersRef);
      if (answersSnapshot.exists()) {
        const answers = answersSnapshot.val();
        for (const [senderId, senderAnswers] of Object.entries(answers)) {
          if (senderId !== userId) {
            const answerToUserRef = ref(
              rtdb,
              `rooms/${roomId}/answers/${senderId}/${userId}`
            );
            await remove(answerToUserRef);
          }
        }
      }

      // Clean up old ICE candidates
      const candidatesRef = ref(rtdb, `rooms/${roomId}/candidates/${userId}`);
      await remove(candidatesRef);

      // Also clean up candidates to this user from other participants
      const allCandidatesRef = ref(rtdb, `rooms/${roomId}/candidates`);
      const candidatesSnapshot = await get(allCandidatesRef);
      if (candidatesSnapshot.exists()) {
        const candidates = candidatesSnapshot.val();
        for (const [senderId, senderCandidates] of Object.entries(candidates)) {
          if (senderId !== userId && senderCandidates) {
            const candidatesToUserRef = ref(
              rtdb,
              `rooms/${roomId}/candidates/${senderId}/${userId}`
            );
            await remove(candidatesToUserRef);
          }
        }
      }

      console.log("Successfully cleaned up all signaling data");
    } catch (error) {
      console.error("Error cleaning up signaling data:", error);
    }
  };

  // Reinitialize media stream
  const reinitializeMedia = async (): Promise<boolean> => {
    try {
      mediaInitAttempts.current += 1;
      console.log(
        `Reinitializing media (attempt ${mediaInitAttempts.current})...`
      );

      // Stop any existing tracks
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      // Create constraints based on selected devices
      const constraints: MediaStreamConstraints = {
        audio: selectedAudioDevice
          ? { deviceId: { exact: selectedAudioDevice } }
          : true,
        video: selectedVideoDevice
          ? {
              deviceId: { exact: selectedVideoDevice },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      };

      console.log("Using media constraints:", constraints);

      // Try to get the stream with both audio and video
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("Successfully got media stream with both audio and video");

        // Check what we actually got
        const hasVideoTrack = stream.getVideoTracks().length > 0;
        const hasAudioTrack = stream.getAudioTracks().length > 0;

        setHasVideo(hasVideoTrack);
        setHasAudio(hasAudioTrack);

        // Make sure video and audio are initially enabled
        stream.getVideoTracks().forEach((track) => {
          track.enabled = isVideoEnabled;
        });
        stream.getAudioTracks().forEach((track) => {
          track.enabled = isAudioEnabled;
        });

        console.log(
          `Stream has video: ${hasVideoTrack}, has audio: ${hasAudioTrack}`
        );

        // Update local stream
        setLocalStream(stream);
        originalStream.current = stream;

        // Update peer connections with new stream
        Object.values(peerConnections.current).forEach((pc) => {
          const senders = pc.getSenders();

          stream.getTracks().forEach((track) => {
            const sender = senders.find((s) => s.track?.kind === track.kind);
            if (sender) {
              console.log(`Replacing ${track.kind} track in peer connection`);
              sender.replaceTrack(track).catch((err) => {
                console.error(`Error replacing ${track.kind} track:`, err);
              });
            } else {
              console.log(`Adding new ${track.kind} track to peer connection`);
              pc.addTrack(track, stream);
            }
          });
        });

        return true;
      } catch (error) {
        console.error("Error getting media with both audio and video:", error);

        // Try with just audio if video fails
        try {
          console.log("Trying with audio only...");
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          console.log("Successfully got audio-only stream");

          setHasVideo(false);
          setHasAudio(true);

          // Make sure audio is initially enabled
          audioStream.getAudioTracks().forEach((track) => {
            track.enabled = isAudioEnabled;
          });

          setLocalStream(audioStream);
          originalStream.current = audioStream;

          // Update peer connections with new stream
          Object.values(peerConnections.current).forEach((pc) => {
            const senders = pc.getSenders();

            // Remove any existing video tracks from peer connections
            const videoSender = senders.find((s) => s.track?.kind === "video");
            if (videoSender) {
              pc.removeTrack(videoSender);
            }

            // Add or replace audio tracks
            audioStream.getAudioTracks().forEach((track) => {
              const sender = senders.find((s) => s.track?.kind === track.kind);
              if (sender) {
                sender.replaceTrack(track).catch((err) => {
                  console.error(`Error replacing audio track:`, err);
                });
              } else {
                pc.addTrack(track, audioStream);
              }
            });
          });

          return true;
        } catch (audioError) {
          console.error("Error getting audio-only stream:", audioError);
          setHasVideo(false);
          setHasAudio(false);
          setWebRTCError(
            "Could not access camera or microphone. Please check your permissions and try again."
          );
          return false;
        }
      }
    } catch (error) {
      console.error("Error in reinitializeMedia:", error);
      setWebRTCError(
        "Failed to initialize media devices. Please check your permissions and try again."
      );
      return false;
    }
  };

  // Initialize local media stream
  const initLocalStream = async (video = true, audio = true) => {
    try {
      // If we already have a stream, stop all tracks
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      console.log("Initializing local media stream");

      // Create constraints based on selected devices and requested media types
      const constraints: MediaStreamConstraints = {
        audio: audio
          ? selectedAudioDevice
            ? { deviceId: { exact: selectedAudioDevice } }
            : true
          : false,
        video: video
          ? selectedVideoDevice
            ? {
                deviceId: { exact: selectedVideoDevice },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
          : false,
      };

      console.log("Using media constraints:", constraints);

      // Try to get the stream
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("Local media stream initialized successfully");

      // Check what we actually got
      const hasVideoTrack = stream.getVideoTracks().length > 0;
      const hasAudioTrack = stream.getAudioTracks().length > 0;

      setHasVideo(hasVideoTrack);
      setHasAudio(hasAudioTrack);

      // Make sure video and audio are initially enabled
      stream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

      setIsVideoEnabled(true);
      setIsAudioEnabled(true);

      console.log(
        `Stream has video: ${hasVideoTrack}, has audio: ${hasAudioTrack}`
      );

      setLocalStream(stream);
      originalStream.current = stream;
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);

      // Try with just audio if video fails
      if (video) {
        try {
          console.log("Video failed, trying with audio only...");
          return initLocalStream(false, true);
        } catch (audioError) {
          console.error("Error getting audio-only stream:", audioError);
        }
      } else if (!video && audio) {
        try {
          console.log("Trying with audio only...");
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          console.log("Successfully got audio-only stream");

          setHasVideo(false);
          setHasAudio(true);
          setIsAudioEnabled(true);

          setLocalStream(audioOnlyStream);
          originalStream.current = audioOnlyStream;
          return audioOnlyStream;
        } catch (audioError) {
          console.error("Error getting audio-only stream:", audioError);
        }
      }

      setHasVideo(false);
      setHasAudio(false);
      setWebRTCError(
        "Failed to access camera and microphone. Please check your permissions."
      );
      return null;
    }
  };

  // Clear WebRTC error
  const clearWebRTCError = () => {
    setWebRTCError(null);
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen sharing
      if (screenShareStream.current) {
        screenShareStream.current.getTracks().forEach((track) => track.stop());
      }

      // Revert to original stream
      if (originalStream.current && localStream) {
        const videoTracks = localStream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoTracks.forEach((track) => localStream.removeTrack(track));
        }

        originalStream.current.getVideoTracks().forEach((track) => {
          localStream.addTrack(track);
        });

        // Update all peer connections with the original stream
        Object.values(peerConnections.current).forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find(
            (sender) => sender.track && sender.track.kind === "video"
          );

          if (videoSender && originalStream.current) {
            const videoTrack = originalStream.current.getVideoTracks()[0];
            if (videoTrack) {
              videoSender.replaceTrack(videoTrack);
            }
          }
        });

        setIsScreenSharing(false);
      }
    } else {
      // Check if screen sharing is supported
      if (!isScreenShareSupported) {
        setWebRTCError(
          "Screen sharing is not supported in this environment. Please use a secure (HTTPS) connection or a compatible browser."
        );
        return;
      }

      try {
        // Start screen sharing
        console.log("Starting screen sharing");

        // Attempt to use getDisplayMedia with appropriate options
        const displayMedia: any = { video: true };
        // For better compatibility
        if (
          typeof window !== "undefined" &&
          window.navigator.userAgent.indexOf("Firefox") > -1
        ) {
          displayMedia.video = {
            mediaSource: "screen",
          };
        }

        let displayStream;
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia(
            displayMedia
          );
        } catch (err) {
          console.error("Error starting screen share:", err);

          // Check for specific error types
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            throw new Error("Screen sharing permission denied by user");
          } else if (
            err instanceof DOMException &&
            err.name === "NotSupportedError"
          ) {
            throw new Error(
              "Screen sharing is not supported in this environment"
            );
          } else if (String(err).includes("display-capture")) {
            throw new Error(
              "Screen sharing is not allowed in this preview environment"
            );
          } else {
            throw err;
          }
        }

        screenShareStream.current = displayStream;

        if (localStream) {
          // Replace video track with screen share track
          const videoTracks = localStream.getVideoTracks();
          if (videoTracks.length > 0) {
            videoTracks.forEach((track) => localStream.removeTrack(track));
          }

          displayStream.getVideoTracks().forEach((track) => {
            localStream.addTrack(track);

            // When user stops screen sharing via browser UI
            track.onended = () => {
              console.log("Screen sharing ended via browser UI");
              toggleScreenShare();
            };
          });

          // Update all peer connections with the screen share stream
          Object.values(peerConnections.current).forEach((pc) => {
            const senders = pc.getSenders();
            const videoSender = senders.find(
              (sender) => sender.track && sender.track.kind === "video"
            );

            if (videoSender) {
              const videoTrack = displayStream.getVideoTracks()[0];
              if (videoTrack) {
                videoSender.replaceTrack(videoTrack);
              }
            }
          });

          setIsScreenSharing(true);
          console.log("Screen sharing started successfully");
        }
      } catch (error: any) {
        console.error("Error starting screen share:", error);
        setWebRTCError(
          error.message || "Failed to start screen sharing. Please try again."
        );
      }
    }
  };

  // Toggle recording
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorder.current) {
        console.log("Stopping recording");
        mediaRecorder.current.stop();
        setIsRecording(false);
      }
    } else {
      // Start recording
      if (!localStream) {
        console.error("Cannot start recording: No local stream available");
        setWebRTCError("Cannot start recording: No local stream available");
        return;
      }

      try {
        console.log("Starting recording");
        // Get all streams (local + remote)
        const streams = [localStream];
        peers.forEach((peer) => {
          if (peer.stream) streams.push(peer.stream);
        });

        // Create a canvas to combine all streams
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          console.error("Could not get canvas context");
          setWebRTCError(
            "Failed to start recording: Could not initialize canvas"
          );
          return;
        }

        // Set canvas size
        const width = 1280;
        const height = 720;
        canvas.width = width;
        canvas.height = height;

        // Calculate grid layout
        const totalStreams = streams.length;
        const cols = Math.ceil(Math.sqrt(totalStreams));
        const rows = Math.ceil(totalStreams / cols);

        // Size for each video
        const videoWidth = width / cols;
        const videoHeight = height / rows;

        // Create video elements for each stream
        const videoElements: HTMLVideoElement[] = [];

        for (const stream of streams) {
          const video = document.createElement("video");
          video.srcObject = stream;
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;

          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => {
              video.play().then(() => resolve());
            };
          });

          videoElements.push(video);
        }

        // Create a stream from the canvas
        const canvasStream = canvas.captureStream(30);

        // Add audio tracks from all streams
        streams.forEach((stream) => {
          const audioTracks = stream.getAudioTracks();
          audioTracks.forEach((track) => {
            canvasStream.addTrack(track);
          });
        });

        // Draw videos to canvas
        const drawToCanvas = () => {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          videoElements.forEach((video, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);

            ctx.drawImage(
              video,
              col * videoWidth,
              row * videoHeight,
              videoWidth,
              videoHeight
            );
          });

          if (isRecording) {
            requestAnimationFrame(drawToCanvas);
          }
        };

        // Start recording
        const options = { mimeType: "video/webm;codecs=vp9,opus" };
        mediaRecorder.current = new MediaRecorder(canvasStream, options);
        recordedChunks.current = [];

        mediaRecorder.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunks.current.push(event.data);
          }
        };

        mediaRecorder.current.onstop = async () => {
          // Create a blob from the recorded chunks
          const blob = new Blob(recordedChunks.current, {
            type: "video/webm",
          });

          if (user && currentRoomId) {
            // Upload to Firebase Storage
            const fileName = `recordings/${currentRoomId}/${
              user.uid
            }_${Date.now()}.webm`;
            const fileRef = storageRef(storage, fileName);

            try {
              console.log("Uploading recording to Firebase Storage");
              await uploadBytes(fileRef, blob);
              const downloadURL = await getDownloadURL(fileRef);
              setRecordingURL(downloadURL);

              // Save recording reference to the room
              const recordingRef = ref(
                rtdb,
                `rooms/${currentRoomId}/recordings/${Date.now()}`
              );
              await set(recordingRef, {
                userId: user.uid,
                userName: user.displayName,
                url: downloadURL,
                timestamp: Date.now(),
              });

              console.log("Recording saved:", downloadURL);
            } catch (error) {
              console.error("Error uploading recording:", error);
              setWebRTCError("Failed to upload recording. Please try again.");
            }
          }

          // Clean up
          videoElements.forEach((video) => {
            video.srcObject = null;
          });
        };

        mediaRecorder.current.start(1000);
        drawToCanvas();
        setIsRecording(true);
        console.log("Recording started successfully");
      } catch (error) {
        console.error("Error starting recording:", error);
        setWebRTCError("Failed to start recording. Please try again.");
      }
    }
  };

  // Create a peer connection
  const createPeerConnection = (
    peerId: string,
    roomId: string,
    initiator = false
  ): RTCPeerConnection | null => {
    if (!user || !roomId) {
      console.warn(
        "Cannot create peer connection: user or currentRoomId is missing.",
        { user, roomId }
      );
      return null;
    }

    // If we already have a connection to this peer, close and recreate it
    if (peerConnections.current[peerId]) {
      console.log(
        `Closing existing peer connection for ${peerId} before creating a new one`
      );
      try {
        peerConnections.current[peerId].close();
      } catch (err) {
        console.error(`Error closing existing peer connection:`, err);
      }
      delete peerConnections.current[peerId];
    }

    try {
      console.log(
        `Creating new peer connection to ${peerId}, initiator: ${initiator}`
      );
      const peerConnection = new RTCPeerConnection(
        configuration as RTCConfiguration
      );
      peerConnections.current[peerId] = peerConnection;

      // Critical: Handle incoming tracks
      peerConnection.ontrack = (event) => {
        console.log(`Received track from peer ${peerId}:`, event.track.kind);

        // Use the event's streams if available (most browser implementations)
        if (event.streams && event.streams.length > 0) {
          const remoteStream = event.streams[0];
          console.log(
            `Using remote stream directly from event:`,
            remoteStream.id
          );

          setPeers((prevPeers) => {
            return prevPeers.map((peer) => {
              if (peer.id === peerId) {
                console.log(
                  `Setting stream for peer ${peerId}:`,
                  remoteStream.id
                );
                return {
                  ...peer,
                  stream: remoteStream,
                  connection: peerConnection,
                };
              }
              return peer;
            });
          });
        } else {
          // Fallback if event doesn't provide streams (rare/older browsers)
          console.log(
            `No streams in track event, creating new stream for ${peerId}`
          );
          let peerStream: MediaStream | undefined;

          // Try to find existing stream in peers array
          setPeers((prevPeers) => {
            const updatedPeers = prevPeers.map((peer) => {
              if (peer.id === peerId) {
                // If this peer already has a stream, add track to it
                if (peer.stream) {
                  peerStream = peer.stream;
                  try {
                    peer.stream.addTrack(event.track);
                  } catch (err) {
                    console.error(
                      `Error adding track to existing stream:`,
                      err
                    );
                    // Create new stream if adding track fails
                    peerStream = new MediaStream([event.track]);
                  }
                  return {
                    ...peer,
                    stream: peerStream,
                    connection: peerConnection,
                  };
                } else {
                  // Create new stream for this peer
                  peerStream = new MediaStream([event.track]);
                  return {
                    ...peer,
                    stream: peerStream,
                    connection: peerConnection,
                  };
                }
              }
              return peer;
            });
            return updatedPeers;
          });
        }
      };

      // Add local tracks to the peer connection
      if (localStream && localStream.getTracks().length > 0) {
        console.log(
          `Adding ${
            localStream.getTracks().length
          } local tracks to peer connection`
        );
        localStream.getTracks().forEach((track) => {
          try {
            peerConnection.addTrack(track, localStream);
          } catch (err) {
            console.error(
              `Error adding ${track.kind} track to connection:`,
              err
            );
          }
        });
      } else {
        // Initialize local stream if not already done
        console.log("No local stream available, initializing one");
        initLocalStream()
          .then((stream) => {
            if (stream) {
              stream.getTracks().forEach((track) => {
                try {
                  peerConnection.addTrack(track, stream);
                } catch (err) {
                  console.error(`Error adding track to connection:`, err);
                }
              });
            } else {
              console.error("Failed to initialize local stream");
              setWebRTCError("Failed to initialize local stream");
              joinAttemptedRef.current = false;
            }
          })
          .catch((error) => {
            const errorMessage = "Failed to initialize local stream";
            console.error(errorMessage, error);
            setWebRTCError(errorMessage);
            joinAttemptedRef.current = false;
          });
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(
            `Generated ICE candidate for peer ${peerId}:`,
            event.candidate
          );
          const candidateRef = ref(
            rtdb,
            `rooms/${roomId}/candidates/${user.uid}/${peerId}`
          );
          push(candidateRef, event.candidate.toJSON());
        }
      };

      // Handle ICE gathering state changes
      peerConnection.onicegatheringstatechange = () => {
        console.log(
          `ICE gathering state: ${peerConnection.iceGatheringState} for peer ${peerId}`
        );
      };

      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        console.log(
          `ICE connection state change: ${peerConnection.iceConnectionState} for peer ${peerId}`
        );

        if (
          peerConnection.iceConnectionState === "connected" ||
          peerConnection.iceConnectionState === "completed"
        ) {
          console.log(`Connection to peer ${peerId} established successfully`);
          setConnectionStatus("connected");
        } else if (peerConnection.iceConnectionState === "failed") {
          console.log(
            `ICE connection to peer ${peerId} failed, attempting to restart ICE`
          );
          try {
            peerConnection.restartIce();
          } catch (err) {
            console.error(`Error restarting ICE:`, err);
          }

          // Update connection status, but don't set to failed unless all connections are failed
          const allPeersFailed = Object.values(peerConnections.current).every(
            (pc) =>
              pc.iceConnectionState === "failed" ||
              pc.iceConnectionState === "disconnected"
          );

          if (allPeersFailed) {
            setConnectionStatus("failed");
          }
        } else if (peerConnection.iceConnectionState === "disconnected") {
          console.log(
            `ICE connection to peer ${peerId} disconnected, waiting for reconnection`
          );

          // Only set disconnected if all connections are disconnected
          const allPeersDisconnected = Object.values(
            peerConnections.current
          ).every(
            (pc) =>
              pc.iceConnectionState === "disconnected" ||
              pc.iceConnectionState === "failed"
          );

          if (allPeersDisconnected) {
            setConnectionStatus("disconnected");
          }

          // Try to restart ICE after a short delay
          setTimeout(() => {
            if (peerConnection.iceConnectionState === "disconnected") {
              console.log(`Attempting to restart ICE for peer ${peerId}`);
              try {
                peerConnection.restartIce();
              } catch (err) {
                console.error(`Error restarting ICE:`, err);
              }
            }
          }, 2000);
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log(
          `Connection state change: ${peerConnection.connectionState} for peer ${peerId}`
        );

        if (peerConnection.connectionState === "connected") {
          console.log(`Connection to peer ${peerId} established`);
          setConnectionStatus("connected");
        } else if (
          peerConnection.connectionState === "failed" ||
          peerConnection.connectionState === "closed"
        ) {
          console.log(`Connection to peer ${peerId} failed or closed`);

          // Close and remove this peer connection
          try {
            peerConnections.current[peerId]?.close();
          } catch (err) {
            console.error(`Error closing peer connection:`, err);
          }
          delete peerConnections.current[peerId];

          // Only set status to failed if all connections are failed/closed
          const allConnectionsFailed = Object.values(
            peerConnections.current
          ).every(
            (pc) =>
              pc.connectionState === "failed" || pc.connectionState === "closed"
          );

          if (
            allConnectionsFailed ||
            Object.keys(peerConnections.current).length === 0
          ) {
            setConnectionStatus("failed");
          }
        }
      };

      // Handle signaling state changes
      peerConnection.onsignalingstatechange = () => {
        console.log(
          `Signaling state change: ${peerConnection.signalingState} for peer ${peerId}`
        );
      };

      // Handle negotiation needed
      peerConnection.onnegotiationneeded = async () => {
        if (initiator && roomId && user) {
          console.log(`Negotiation needed for peer ${peerId}, creating offer`);
          try {
            // If not in stable state, wait for it
            if (peerConnection.signalingState !== "stable") {
              console.log(`Connection not stable, delaying offer creation`);
              return;
            }

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            console.log(`Sending offer to peer ${peerId}:`, offer);
            const offerRef = ref(
              rtdb,
              `rooms/${roomId}/offers/${user.uid}/${peerId}`
            );
            await set(offerRef, {
              type: "offer",
              sdp: peerConnection.localDescription?.sdp,
            });
          } catch (error) {
            console.error(
              `Error during negotiation with peer ${peerId}:`,
              error
            );
            setWebRTCError("Failed to negotiate connection. Please try again.");
          }
        }
      };

      // Handle incoming tracks
      peerConnection.ontrack = (event) => {
        console.log(
          `Received track from peer ${peerId}:`,
          event.track.kind,
          event
        );

        // Important: We need to use the stream from the event for most browsers
        // This is critical - using event.streams[0] if available is more reliable
        let remoteStream: MediaStream;

        if (event.streams && event.streams[0]) {
          console.log(`Using event stream for peer ${peerId}`);
          remoteStream = event.streams[0];
        } else {
          console.log(`Creating new stream for peer ${peerId}`);
          remoteStream = new MediaStream();
          remoteStream.addTrack(event.track);
        }

        setPeers((prevPeers) => {
          const peerIndex = prevPeers.findIndex((p) => p.id === peerId);
          if (peerIndex !== -1) {
            const updatedPeers = [...prevPeers];
            const existingPeer = updatedPeers[peerIndex];

            // Always make sure we have the latest track
            console.log(
              `Adding ${event.track.kind} track to peer ${peerId} stream`
            );

            // Listen for track ended events
            event.track.onended = () => {
              console.log(
                `Track ${event.track.kind} from peer ${peerId} ended`
              );
            };

            // Listen for mute/unmute events
            event.track.onmute = () => {
              console.log(
                `Track ${event.track.kind} from peer ${peerId} muted`
              );
            };

            event.track.onunmute = () => {
              console.log(
                `Track ${event.track.kind} from peer ${peerId} unmuted`
              );
            };

            updatedPeers[peerIndex] = {
              ...existingPeer,
              stream: remoteStream,
              connection: peerConnection,
            };

            console.log(`Updated peer ${peerId} with stream:`, remoteStream);
            return updatedPeers;
          }
          return prevPeers;
        });
      };

      return peerConnection;
    } catch (error) {
      console.error(`Error creating peer connection to ${peerId}:`, error);
      setWebRTCError("Failed to create peer connection. Please try again.");
      return null;
    }
  };

  // Set up WebRTC listeners
  const setupWebRTCListeners = (roomId: string, currentRoom: Room | null) => {
    if (!user || !roomId || !currentRoom) {
      console.error("Cannot set up WebRTC listeners: No user", {
        user,
        roomId,
        currentRoom,
      });
      return;
    }

    if (listenersSetupRef.current) {
      console.log("WebRTC listeners already set up, cleaning up first");
      cleanupWebRTCListeners();
    }

    console.log(`Setting up WebRTC listeners for room ${roomId}`);

    // Listen for participants
    console.log("Setting up participants listener");
    const participantsRef = ref(rtdb, `rooms/${roomId}/participants`);
    const participantsUnsubscribe = onValue(
      participantsRef,
      (snapshot) => {
        if (snapshot.exists() && user) {
          const participants = snapshot.val();
          console.log(
            `Participants updated: ${
              Object.keys(participants).length
            } participants:`,
            participants
          );

          // Add new peers
          Object.entries(participants).forEach(
            ([id, participant]: [string, any]) => {
              if (id !== user.uid && !peerConnections.current[id]) {
                console.log({ id, currentRoom });
                console.log(
                  `Creating peer connection to new participant: ${id}`
                );
                setPeers((prevPeers) => {
                  if (!prevPeers.some((p) => p.id === id)) {
                    return [
                      ...prevPeers,
                      {
                        id,
                        displayName: participant.displayName,
                      },
                    ];
                  }
                  return prevPeers;
                });
                createPeerConnection(id, roomId, true);
              }
            }
          );

          // Remove peers that left
          setPeers((prevPeers) => {
            const updatedPeers = prevPeers.filter((peer) =>
              Object.keys(participants).includes(peer.id)
            );
            if (updatedPeers.length !== prevPeers.length) {
              console.log(
                `Removed ${
                  prevPeers.length - updatedPeers.length
                } peers that left`
              );
            }
            return updatedPeers;
          });

          // Close connections to peers that left
          Object.keys(peerConnections.current).forEach((id) => {
            if (!Object.keys(participants).includes(id)) {
              console.log(`Closing connection to peer that left: ${id}`);
              peerConnections.current[id].close();
              delete peerConnections.current[id];
            }
          });
        }
      },
      (error) => {
        console.error("Error in participants listener:", error);
        setWebRTCError(
          "Failed to connect to room participants. Please try again."
        );
      }
    );
    participantsUnsubscribeRef.current = participantsUnsubscribe;

    // Listen for offers
    console.log("Setting up offers listener");
    const offersRef = ref(rtdb, `rooms/${roomId}/offers`);
    const offersUnsubscribe = onValue(
      offersRef,
      (snapshot) => {
        if (snapshot.exists() && user) {
          const offers = snapshot.val();
          console.log("Received offers:", offers);

          Object.entries(offers).forEach(
            ([senderId, senderOffers]: [string, any]) => {
              console.log({ senderId, userId: user.uid });
              if (senderId !== user.uid) {
                Object.entries(senderOffers).forEach(
                  async ([receiverId, offer]: [string, any]) => {
                    if (receiverId === user.uid && offer) {
                      console.log(`Received offer from ${senderId}:`, offer);

                      // Create peer connection if it doesn't exist
                      let peerConnection = peerConnections.current[senderId];

                      if (!peerConnection) {
                        console.log(
                          `Creating new peer connection for ${senderId} in response to offer`
                        );
                        const newConnection = createPeerConnection(
                          senderId,
                          roomId,
                          false
                        );

                        if (newConnection) {
                          peerConnection = newConnection;
                        } else {
                          console.error(
                            `Failed to create peer connection for ${senderId}`
                          );
                          return;
                        }
                      }

                      if (!peerConnection) {
                        console.error(
                          `Failed to create peer connection for ${senderId}`
                        );
                        return;
                      }

                      // Ensure we have a valid RTCPeerConnection before proceeding
                      if (!(peerConnection instanceof RTCPeerConnection)) {
                        console.error(
                          `Invalid peer connection type for ${senderId}, recreating connection`
                        );
                        // Try to recreate the connection
                        let newConnection = createPeerConnection(
                          senderId,
                          roomId,
                          false
                        );
                        if (!newConnection) {
                          console.error(
                            `Failed to recreate peer connection for ${senderId}`
                          );
                          return;
                        }
                        peerConnection = newConnection;
                      }

                      // Check if we're in a state where we can process the offer
                      if (
                        peerConnection.signalingState === "have-local-offer"
                      ) {
                        console.log(
                          `Signaling state conflict with ${senderId}, resolving glare situation`
                        );

                        // Glare situation: both peers created an offer
                        // Compare user IDs to determine who should accept and who should create a new offer
                        if (user.uid > senderId) {
                          console.log(
                            `This client (${user.uid}) wins glare resolution, waiting for remote to process our offer`
                          );
                          return; // Let the other peer process our offer first
                        } else {
                          console.log(
                            `Remote peer (${senderId}) wins glare resolution, rolling back our offer`
                          );
                          try {
                            await peerConnection.setLocalDescription({
                              type: "rollback",
                            });
                          } catch (err) {
                            console.error(
                              `Error rolling back local description:`,
                              err
                            );

                            // If rollback fails, create a new connection
                            try {
                              peerConnection.close();
                            } catch (closeErr) {
                              console.error(
                                `Error closing connection:`,
                                closeErr
                              );
                            }

                            delete peerConnections.current[senderId];
                            const newConnection = createPeerConnection(
                              senderId,
                              roomId,
                              false
                            );

                            if (newConnection) {
                              peerConnection = newConnection;
                            } else {
                              console.error(
                                `Failed to create peer connection for ${senderId}`
                              );
                              return;
                            }
                            if (!peerConnection) {
                              console.error(
                                `Failed to recreate peer connection for ${senderId}`
                              );
                              return;
                            }
                          }
                        }
                      } else if (peerConnection.signalingState !== "stable") {
                        console.log(
                          `Cannot process offer in current signaling state: ${peerConnection.signalingState}`
                        );

                        // If we're in a weird state, wait a bit and check again
                        setTimeout(async () => {
                          if (peerConnection.signalingState !== "stable") {
                            console.log(
                              `Still in unstable state (${peerConnection.signalingState}), resetting connection`
                            );
                            try {
                              peerConnection.close();
                            } catch (err) {
                              console.error(
                                `Error closing unstable connection:`,
                                err
                              );
                            }

                            delete peerConnections.current[senderId];
                            const newPeerConnection = createPeerConnection(
                              senderId,
                              roomId,
                              false
                            );
                            if (!newPeerConnection) {
                              console.error(
                                `Failed to recreate peer connection for ${senderId}`
                              );
                              return;
                            }

                            if (
                              newPeerConnection instanceof RTCPeerConnection
                            ) {
                              processOffer(newPeerConnection, senderId, offer);
                            }
                          }
                        }, 1000);
                        return;
                      }

                      // Process the offer
                      processOffer(peerConnection, senderId, offer);
                    }
                  }
                );
              }
            }
          );
        }
      },
      (error) => {
        console.error("Error in offers listener:", error);
        setWebRTCError(
          "Failed to process connection offers. Please try again."
        );
      }
    );
    offersUnsubscribeRef.current = offersUnsubscribe;

    // Helper function to process an offer
    const processOffer = async (
      peerConnection: RTCPeerConnection | null,
      senderId: string,
      offer: any
    ) => {
      if (!peerConnection) {
        console.error(
          `Cannot process offer: Missing peer connection for ${senderId}`
        );
        return;
      }
      try {
        // Set remote description and create answer
        console.log(`Setting remote description for ${senderId}`);
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({
            type: "offer",
            sdp: offer.sdp,
          })
        );

        console.log(`Creating answer for ${senderId}`);
        const answer = await peerConnection.createAnswer();

        console.log(
          `Setting local description (answer) for ${senderId}`,
          answer
        );
        await peerConnection.setLocalDescription(answer);

        console.log(`Sending answer to ${senderId}`);
        const answerRef = ref(
          rtdb,
          `rooms/${roomId}/answers/${user.uid}/${senderId}`
        );
        await set(answerRef, {
          type: "answer",
          sdp: peerConnection.localDescription?.sdp,
        });
      } catch (error) {
        console.error(`Error processing offer from ${senderId}:`, error);
        setWebRTCError(
          "Failed to respond to connection offer. Please try again."
        );
      }
    };

    // Listen for answers
    console.log("Setting up answers listener");
    const answersRef = ref(rtdb, `rooms/${roomId}/answers`);
    const answersUnsubscribe = onValue(
      answersRef,
      (snapshot) => {
        if (snapshot.exists() && user) {
          const answers = snapshot.val();
          console.log("Received answers:", answers);

          Object.entries(answers).forEach(
            ([senderId, senderAnswers]: [string, any]) => {
              Object.entries(senderAnswers).forEach(
                async ([receiverId, answer]: [string, any]) => {
                  if (receiverId === user.uid && answer) {
                    console.log(`Received answer from ${senderId}:`, answer);
                    const peerConnection = peerConnections.current[senderId];

                    if (!peerConnection) {
                      console.warn(
                        `Received answer from ${senderId} but no peer connection exists`
                      );
                      return;
                    }

                    if (peerConnection.signalingState === "have-local-offer") {
                      try {
                        await peerConnection.setRemoteDescription(
                          new RTCSessionDescription({
                            type: "answer",
                            sdp: answer.sdp,
                          })
                        );
                        console.log(
                          `Set remote description (answer) for ${senderId}`
                        );

                        // Remove the processed answer to avoid re-processing
                        const processedAnswerRef = ref(
                          rtdb,
                          `rooms/${roomId}/answers/${senderId}/${receiverId}`
                        );
                        await remove(processedAnswerRef);
                      } catch (error) {
                        console.error(
                          `Error setting remote description for ${senderId}:`,
                          error
                        );
                        setWebRTCError(
                          "Failed to establish connection. Please try again."
                        );

                        // If the error is serious, try to recreate the connection
                        if (
                          String(error).includes(
                            "Failed to set remote answer sdp:"
                          ) ||
                          String(error).includes(
                            "Failed to set remote description"
                          )
                        ) {
                          try {
                            console.log(
                              `Recreating failed connection to ${senderId}`
                            );
                            peerConnection.close();
                          } catch (closeErr) {
                            console.error(
                              `Error closing failed connection:`,
                              closeErr
                            );
                          }

                          delete peerConnections.current[senderId];
                          const newPeerConnection = createPeerConnection(
                            senderId,
                            roomId,
                            true
                          );
                          if (newPeerConnection) {
                            console.log(
                              `Successfully recreated connection to ${senderId}`
                            );
                          }
                        }
                      }
                    } else {
                      console.warn(
                        `Skipping answer from ${senderId}, signalingState: ${peerConnection.signalingState}`
                      );
                    }
                  }
                }
              );
            }
          );
        }
      },
      (error) => {
        console.error("Error in answers listener:", error);
        setWebRTCError(
          "Failed to process connection answers. Please try again."
        );
      }
    );
    answersUnsubscribeRef.current = answersUnsubscribe;

    // Listen for ICE candidates
    console.log("Setting up ICE candidates listener");
    const candidatesRef = ref(rtdb, `rooms/${roomId}/candidates`);
    const candidatesUnsubscribe = onValue(
      candidatesRef,
      (snapshot) => {
        if (snapshot.exists() && user) {
          const candidates = snapshot.val();

          Object.entries(candidates).forEach(
            ([senderId, senderCandidates]: [string, any]) => {
              Object.entries(senderCandidates).forEach(
                ([receiverId, receiverCandidates]: [string, any]) => {
                  if (receiverId === user.uid) {
                    const peerConnection = peerConnections.current[senderId];

                    if (peerConnection) {
                      Object.values(receiverCandidates).forEach(
                        async (candidate: any) => {
                          try {
                            // Ensure connection is ready to receive candidates
                            if (!peerConnection.remoteDescription) {
                              console.log(
                                `Remote description not set for ${senderId}, queuing ICE candidate`
                              );
                              return; // Skip for now, will be retried later
                            }

                            console.log(
                              `Adding ICE candidate from ${senderId}`,
                              candidate
                            );
                            await peerConnection.addIceCandidate(
                              new RTCIceCandidate(candidate)
                            );

                            // Clean up processed candidate
                            const candidateKeys =
                              Object.keys(receiverCandidates);
                            if (candidateKeys.length > 0) {
                              const candidateKey = candidateKeys.find(
                                (key) =>
                                  JSON.stringify(receiverCandidates[key]) ===
                                  JSON.stringify(candidate)
                              );
                              if (candidateKey) {
                                const processedCandidateRef = ref(
                                  rtdb,
                                  `rooms/${roomId}/candidates/${senderId}/${receiverId}/${candidateKey}`
                                );
                                await remove(processedCandidateRef);
                              }
                            }
                          } catch (error) {
                            console.error(
                              `Error adding ICE candidate from ${senderId}:`,
                              error
                            );

                            // Don't show error message for minor ICE issues
                            if (
                              String(error).includes(
                                "Cannot add ICE candidate"
                              ) &&
                              !String(error).includes("Connection failed")
                            ) {
                              console.log(`Non-critical ICE error: ${error}`);
                            } else {
                              setWebRTCError(
                                "Connection issue. Try reconnecting if video doesn't appear."
                              );
                            }
                          }
                        }
                      );
                    }
                  }
                }
              );
            }
          );
        }
      },
      (error) => {
        console.error("Error in ICE candidates listener:", error);
        setWebRTCError(
          "Failed to process connection candidates. Please try again."
        );
      }
    );
    candidatesUnsubscribeRef.current = candidatesUnsubscribe;

    // Set up connection check interval
    connectionCheckInterval.current = setInterval(() => {
      // Check if we have any connected peers
      const connectedPeers = Object.values(peerConnections.current).filter(
        (pc) =>
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
      );

      if (connectedPeers.length > 0) {
        setConnectionStatus("connected");
      } else if (Object.keys(peerConnections.current).length > 0) {
        // We have peers but none are connected
        const failedPeers = Object.values(peerConnections.current).filter(
          (pc) =>
            pc.iceConnectionState === "failed" ||
            pc.iceConnectionState === "disconnected"
        );

        if (failedPeers.length > 0) {
          setConnectionStatus("failed");
        } else {
          setConnectionStatus("connecting");
        }
      } else {
        console.log("No peers connected, disconnecting...");
        setConnectionStatus("disconnected");
      }
    }, 5000);

    listenersSetupRef.current = true;
    console.log("WebRTC listeners setup complete");
  };

  // Clean up WebRTC listeners
  const cleanupWebRTCListeners = () => {
    console.log("Cleaning up WebRTC listeners");

    if (participantsUnsubscribeRef.current) {
      participantsUnsubscribeRef.current();
      participantsUnsubscribeRef.current = null;
    }

    if (offersUnsubscribeRef.current) {
      offersUnsubscribeRef.current();
      offersUnsubscribeRef.current = null;
    }

    if (answersUnsubscribeRef.current) {
      answersUnsubscribeRef.current();
      answersUnsubscribeRef.current = null;
    }

    if (candidatesUnsubscribeRef.current) {
      candidatesUnsubscribeRef.current();
      candidatesUnsubscribeRef.current = null;
    }

    if (connectionCheckInterval.current) {
      clearInterval(connectionCheckInterval.current);
      connectionCheckInterval.current = null;
    }

    listenersSetupRef.current = false;
  };

  // Join a room
  const joinRoom = async (roomId: string, currentRoom: Room | null) => {
    console.log("Roomid here:", roomId);
    if (!user) {
      const error = "Cannot join room: User not authenticated";
      console.error(error);
      setWebRTCError(error);
      throw new Error(error);
    }

    // Prevent multiple join attempts
    if (joinAttemptedRef.current && currentRoomId === roomId) {
      console.log("Already joining or joined this room");
      return;
    }

    // Track join attempts to prevent infinite loops
    joinAttemptsRef.current += 1;
    if (joinAttemptsRef.current > 3) {
      const error = "Too many join attempts, aborting to prevent infinite loop";
      console.error(error);
      setWebRTCError(error);
      joinAttemptsRef.current = 0;
      throw new Error(error);
    }

    joinAttemptedRef.current = true;
    setWebRTCError(null);
    setConnectionStatus("connecting");

    console.log(`WebRTC joining room: ${roomId}`);

    try {
      // First, close any existing peer connections and clear state
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      setPeers([]);

      // Clean up any existing signaling data - must happen before initializing new connections
      await cleanupSignalingData(roomId, user.uid);

      // Initialize local stream if not already done
      if (!localStream) {
        console.log("Initializing local stream");
        const stream = await initLocalStream();
        if (!stream) {
          const error = "Failed to initialize local stream";
          console.error(error);
          setWebRTCError(error);
          joinAttemptedRef.current = false;
          throw new Error(error);
        }
      } else {
        // Re-enable tracks in case they were disabled
        localStream.getVideoTracks().forEach((track) => {
          if (track) track.enabled = isVideoEnabled;
        });
        localStream.getAudioTracks().forEach((track) => {
          if (track) track.enabled = isAudioEnabled;
        });
      }

      // Set current room ID
      setCurrentRoomId(roomId);

      // Add user to room participants - this will trigger the participant listener in other clients
      console.log(`Adding user ${user.uid} to room participants`);
      const participantRef = ref(
        rtdb,
        `rooms/${roomId}/participants/${user.uid}`
      );
      await set(participantRef, {
        displayName: user.displayName || "Anonymous",
        joined: Date.now(),
      });

      // Set up disconnect handler
      onDisconnect(participantRef).remove();

      // Get existing participants first
      const roomParticipantsRef = ref(rtdb, `rooms/${roomId}/participants`);
      const snapshot = await get(roomParticipantsRef);

      // Set up peers array first before creating connections
      if (snapshot.exists()) {
        const participants = snapshot.val();
        console.log(
          `Found ${Object.keys(participants).length} participants in room`
        );

        // Add peers to state first without creating connections
        Object.entries(participants).forEach(
          ([id, participant]: [string, any]) => {
            if (id !== user.uid) {
              setPeers((prevPeers) => {
                if (!prevPeers.some((p) => p.id === id)) {
                  return [
                    ...prevPeers,
                    {
                      id,
                      displayName: participant.displayName || "Anonymous",
                    },
                  ];
                }
                return prevPeers;
              });
            }
          }
        );
      }

      // Set up WebRTC listeners before creating connections
      setupWebRTCListeners(roomId, currentRoom);

      // Wait a moment for the user to be established in the room
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Now create connections to all participants
      if (snapshot.exists()) {
        const participants = snapshot.val();

        // Create peer connections to all participants except self
        for (const [id, participant] of Object.entries(participants)) {
          if (id !== user.uid) {
            console.log(`Creating initial connection to participant: ${id}`);
            // Create a small delay to ensure previous setup is complete
            await new Promise((resolve) => setTimeout(resolve, 300));

            const peerConnection = createPeerConnection(id, roomId, true);

            if (peerConnection) {
              try {
                // Set up the icecandidate event handler before creating the offer
                // (this should already be set in createPeerConnection but we're making sure)
                peerConnection.onicecandidate = (event) => {
                  if (event.candidate) {
                    console.log(
                      `Generated ICE candidate for peer ${id}:`,
                      event.candidate
                    );
                    const candidateRef = ref(
                      rtdb,
                      `rooms/${roomId}/candidates/${user.uid}/${id}`
                    );
                    push(candidateRef, event.candidate.toJSON());
                  }
                };

                console.log(`Creating offer for peer ${id} with options`);
                const offerOptions = {
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: true,
                };

                const offer = await peerConnection.createOffer();
                console.log(`Offer created for peer ${id}`);
                await peerConnection.setLocalDescription(offer);

                // Allow a bit more time for the local description to be set properly
                await new Promise((resolve) => setTimeout(resolve, 200));

                if (peerConnection.localDescription) {
                  // Send the offer to the remote peer
                  const offerRef = ref(
                    rtdb,
                    `rooms/${roomId}/offers/${user.uid}/${id}`
                  );
                  await set(offerRef, {
                    type: "offer",
                    sdp: peerConnection.localDescription.sdp,
                  });

                  console.log(`Sent offer to participant ${id}`);
                } else {
                  console.error(`LocalDescription is null for peer ${id}`);
                }
              } catch (error) {
                console.error(`Error creating/sending offer to ${id}:`, error);

                // If there's an error with max-bundle, try again with a different configuration
                if (String(error).includes("no BUNDLE group")) {
                  console.log(
                    `Retrying with modified configuration for peer ${id}`
                  );
                  try {
                    // Close the problematic connection
                    peerConnection.close();
                    delete peerConnections.current[id];

                    // Create a new connection with simpler configuration
                    const simpleConfig = {
                      iceServers: [{ urls: "stun:stun1.l.google.com:19302" }],
                      bundlePolicy: "balanced" as RTCBundlePolicy,
                    };

                    const newConnection = new RTCPeerConnection(simpleConfig);
                    peerConnections.current[id] = newConnection;

                    // Add tracks from local stream
                    if (localStream) {
                      localStream.getTracks().forEach((track) => {
                        newConnection.addTrack(track, localStream);
                      });
                    }

                    // Create and send offer with the simpler connection
                    const newOffer = await newConnection.createOffer();
                    await newConnection.setLocalDescription(newOffer);

                    const offerRef = ref(
                      rtdb,
                      `rooms/${roomId}/offers/${user.uid}/${id}`
                    );
                    await set(offerRef, {
                      type: "offer",
                      sdp: newConnection.localDescription?.sdp,
                    });

                    console.log(`Sent alternative offer to participant ${id}`);
                  } catch (retryError) {
                    console.error(`Failed retry with peer ${id}:`, retryError);
                  }
                }
              }
            } else {
              console.error(`Failed to create peer connection for ${id}`);
            }

            // Add a small delay between connection creations to avoid race conditions
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }

      console.log(`Successfully joined WebRTC room: ${roomId}`);
      setConnectionStatus("connected");
      joinAttemptsRef.current = 0;
    } catch (error) {
      console.error("Error in WebRTC joinRoom:", error);
      setWebRTCError(
        error instanceof Error ? error.message : "Failed to join room"
      );
      setConnectionStatus("failed");
      throw error;
    } finally {
      joinAttemptedRef.current = false;
    }
  };

  // Leave room
  const leaveRoom = async () => {
    if (!currentRoomId || !user) return;

    console.log(`Leaving WebRTC room: ${currentRoomId}`);

    try {
      // Clean up signaling data first to prevent race conditions
      await cleanupSignalingData(currentRoomId, user.uid);

      // Remove user from room
      const participantRef = ref(
        rtdb,
        `rooms/${currentRoomId}/participants/${user.uid}`
      );
      await remove(participantRef);

      // Clean up WebRTC listeners
      cleanupWebRTCListeners();

      // Close all peer connections
      Object.values(peerConnections.current).forEach((pc) => {
        try {
          pc.close();
        } catch (err) {
          console.error("Error closing peer connection:", err);
        }
      });

      peerConnections.current = {};
      setPeers([]);

      // Stop screen sharing if active
      if (isScreenSharing && screenShareStream.current) {
        screenShareStream.current.getTracks().forEach((track) => track.stop());
        screenShareStream.current = null;
      }

      // Stop recording if active
      if (isRecording && mediaRecorder.current) {
        try {
          mediaRecorder.current.stop();
        } catch (err) {
          console.error("Error stopping media recorder:", err);
        }
      }

      // Final state updates
      setCurrentRoomId(null);
      setConnectionStatus("disconnected");
      joinAttemptedRef.current = false;
      joinAttemptsRef.current = 0;

      console.log("WebRTC room left successfully");
    } catch (error) {
      console.error("Error while leaving room:", error);
      // Still reset state even if there's an error
      setCurrentRoomId(null);
      setConnectionStatus("disconnected");
      joinAttemptedRef.current = false;
      joinAttemptsRef.current = 0;
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      console.log("Cleaning up WebRTC provider");

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      if (screenShareStream.current) {
        screenShareStream.current.getTracks().forEach((track) => track.stop());
      }

      Object.values(peerConnections.current).forEach((pc) => {
        pc.close();
      });

      if (currentRoomId && user) {
        const participantRef = ref(
          rtdb,
          `rooms/${currentRoomId}/participants/${user.uid}`
        );
        remove(participantRef);
      }

      cleanupWebRTCListeners();
    };
  }, []);

  return (
    <WebRTCContext.Provider
      value={{
        localStream,
        peers,
        isAudioEnabled,
        isVideoEnabled,
        isScreenSharing,
        isRecording,
        toggleAudio,
        toggleVideo,
        toggleScreenShare,
        toggleRecording,
        joinRoom,
        leaveRoom,
        currentRoomId,
        recordingURL,
        webRTCError,
        clearWebRTCError,
        isScreenShareSupported,
        reinitializeMedia,
        mediaState: {
          hasVideo,
          hasAudio,
          videoDevices,
          audioDevices,
          selectedVideoDevice,
          selectedAudioDevice,
        },
        setSelectedVideoDevice,
        setSelectedAudioDevice,
        reconnectPeers,
        connectionStatus,
      }}
    >
      {children}
    </WebRTCContext.Provider>
  );
};

export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error("useWebRTC must be used within a WebRTCProvider");
  }
  return context;
};
