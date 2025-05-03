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
const configuration = {
  iceServers: [
    // { urls: "stun:stun.l.google.com:19302" },
    // { urls: "stun:stun1.l.google.com:19302" },
    // { urls: "stun:stun2.l.google.com:19302" },
    // { urls: "stun:stun3.l.google.com:19302" },
    // { urls: "stun:stun4.l.google.com:19302" },
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

      // Clear existing peers
      setPeers([]);

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

        // Clean up old signaling data
        await cleanupSignalingData(roomId, user.uid);

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
      // Clean up old offers
      const offersRef = ref(rtdb, `rooms/${roomId}/offers/${userId}`);
      await remove(offersRef);

      // Clean up old answers
      const answersRef = ref(rtdb, `rooms/${roomId}/answers/${userId}`);
      await remove(answersRef);

      // Clean up old ICE candidates
      const candidatesRef = ref(rtdb, `rooms/${roomId}/candidates/${userId}`);
      await remove(candidatesRef);

      console.log("Cleaned up old signaling data");
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
          ? { deviceId: { exact: selectedVideoDevice } }
          : true,
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
              sender.replaceTrack(track);
            } else {
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

          setLocalStream(audioStream);
          originalStream.current = audioStream;

          // Update peer connections with new stream
          Object.values(peerConnections.current).forEach((pc) => {
            const senders = pc.getSenders();

            audioStream.getTracks().forEach((track) => {
              const sender = senders.find((s) => s.track?.kind === track.kind);
              if (sender) {
                sender.replaceTrack(track);
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
            ? { deviceId: { exact: selectedVideoDevice } }
            : true
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

      console.log(
        `Stream has video: ${hasVideoTrack}, has audio: ${hasAudioTrack}`
      );

      setLocalStream(stream);
      originalStream.current = stream;
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);

      // Try with just audio if video fails
      if (!video) {
        try {
          console.log("Trying with audio only...");
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          console.log("Successfully got audio-only stream");

          setHasVideo(false);
          setHasAudio(true);

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
  ) => {
    if (!user || !roomId) {
      console.warn(
        "Cannot create peer connection: user or currentRoomId is missing.",
        { user, roomId }
      );
      return;
    }
    // If we already have a connection to this peer, close it
    if (peerConnections.current[peerId]) {
      console.log(`Peer connection already exists for ${peerId}`);
      return;
    }

    console.log(
      `Creating new peer connection to ${peerId}, initiator: ${initiator}`
    );
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections.current[peerId] = peerConnection;

    // Logging
    const logPrefix = `[${peerId}]`;

    // Add local tracks to the peer connection
    if (localStream) {
      console.log(
        `Adding ${
          localStream.getTracks().length
        } local tracks to peer connection`
      );
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    } else {
      // Initialize local stream if not already done

      console.log("Initializing local stream");
      initLocalStream()
        .then((stream) =>
          stream
            ?.getTracks()
            .forEach((track) => peerConnection.addTrack(track, stream))
        )
        .catch((error: any) => {
          const errormessage = "Failed to initialize local stream";
          console.error(error);
          setWebRTCError(errormessage);
          joinAttemptedRef.current = false;
          throw new Error(error);
        });

      console.warn("No local stream available when creating peer connection");
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
        peerConnection.restartIce();
        setConnectionStatus("failed");
      } else if (peerConnection.iceConnectionState === "disconnected") {
        console.log(
          `ICE connection to peer ${peerId} disconnected, waiting for reconnection`
        );
        setConnectionStatus("disconnected");

        // Try to restart ICE after a short delay
        setTimeout(() => {
          if (peerConnection.iceConnectionState === "disconnected") {
            console.log(`Attempting to restart ICE for peer ${peerId}`);
            peerConnection.restartIce();
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
        peerConnections.current[peerId]?.close();
        delete peerConnections.current[peerId];

        console.log(`Connection to peer ${peerId} failed or closed`);
        setConnectionStatus("failed");
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
          console.error(`Error during negotiation with peer ${peerId}:`, error);
          setWebRTCError("Failed to negotiate connection. Please try again.");
        }
      }
    };

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
      console.log(`Received track from peer ${peerId}:`, event.track.kind);
      // const newStream = new MediaStream([event.track]);
      // console.log("Previouse peers", peers);
      // console.log("New stream", newStream);

      // let newStream = new MediaStream();
      // event.streams[0].getTracks().forEach((track) => {
      //   newStream.addTrack(track);
      // });

      // setPeers((prevPeers) => {
      //   const peerIndex = prevPeers.findIndex((p) => p.id === peerId);
      //   console.log("peer index:", peerIndex);
      //   if (peerIndex !== -1) {
      //     const updatedPeers = [...prevPeers];
      //     updatedPeers[peerIndex] = {
      //       ...updatedPeers[peerIndex],
      //       stream: newStream,
      //     };
      //     return updatedPeers;
      //   }
      //   return prevPeers;
      // });

      setPeers((prevPeers) => {
        const peerIndex = prevPeers.findIndex((p) => p.id === peerId);
        if (peerIndex !== -1) {
          const updatedPeers = [...prevPeers];
          const existingPeer = updatedPeers[peerIndex];

          let stream = existingPeer.stream || new MediaStream();

          // Avoid adding duplicate tracks
          if (!stream.getTracks().some((t) => t.id === event.track.id)) {
            stream.addTrack(event.track);
          }

          updatedPeers[peerIndex] = {
            ...existingPeer,
            stream,
          };

          return updatedPeers;
        }
        return prevPeers;
      });
    };

    console.log("current room id", roomId);

    return peerConnection;
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
                  ([receiverId, offer]: [string, any]) => {
                    if (receiverId === user.uid && offer) {
                      console.log(`Received offer from ${senderId}:`, offer);

                      // Create peer connection if it doesn't exist
                      const peerConnection =
                        peerConnections.current[senderId] ||
                        createPeerConnection(senderId, roomId, false);
                      if (peerConnection.signalingState !== "stable") {
                        console.warn(
                          `Skipping offer from ${senderId}, signalingState: ${peerConnection.signalingState}`
                        );
                        return; // Don't process if not in the correct state
                      }
                      // Set remote description and create answer
                      peerConnection
                        .setRemoteDescription(
                          new RTCSessionDescription({
                            type: "offer",
                            sdp: offer.sdp,
                          })
                        )
                        .then(() => {
                          console.log(`Creating answer for ${senderId}`);
                          return peerConnection.createAnswer();
                        })
                        .then((answer) => {
                          console.log(
                            `Setting local description (answer) for ${senderId}:`,
                            answer
                          );
                          return peerConnection.setLocalDescription(answer);
                        })
                        .then(() => {
                          console.log(`Sending answer to ${senderId}`);
                          const answerRef = ref(
                            rtdb,
                            `rooms/${roomId}/answers/${user.uid}/${senderId}`
                          );
                          return set(answerRef, {
                            type: "answer",
                            sdp: peerConnection.localDescription?.sdp,
                          });
                        })
                        .catch((error) => {
                          console.error("Error creating answer:", error);
                          setWebRTCError(
                            "Failed to respond to connection offer. Please try again."
                          );
                        });
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
                ([receiverId, answer]: [string, any]) => {
                  if (receiverId === user.uid && answer) {
                    console.log(`Received answer from ${senderId}:`, answer);
                    const peerConnection = peerConnections.current[senderId];

                    if (
                      peerConnection &&
                      peerConnection.signalingState === "have-local-offer"
                    ) {
                      peerConnection
                        .setRemoteDescription(
                          new RTCSessionDescription({
                            type: "answer",
                            sdp: answer.sdp,
                          })
                        )
                        .then(() => {
                          console.log(
                            `Set remote description (answer) for ${senderId}`
                          );
                        })
                        .catch((error) => {
                          console.error(
                            "Error setting remote description:",
                            error
                          );
                          setWebRTCError(
                            "Failed to establish connection. Please try again."
                          );
                        });
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
                        (candidate: any) => {
                          console.log(
                            `Adding ICE candidate from ${senderId}:`,
                            candidate
                          );
                          peerConnection
                            .addIceCandidate(new RTCIceCandidate(candidate))
                            .catch((error) => {
                              console.error(
                                "Error adding ICE candidate:",
                                error
                              );
                              setWebRTCError(
                                "Failed to establish connection. Please try again."
                              );
                            });
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
      // Clean up any existing signaling data
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
      }

      // Set current room ID
      setCurrentRoomId(roomId);

      // Clear existing peer connections
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      // setPeers([]);

      // Add user to room participants
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
      console.log("Setting up disconnect handler", currentRoomId);
      // Set up WebRTC listeners
      setupWebRTCListeners(roomId, currentRoom);

      console.log(`Successfully joined WebRTC room: ${roomId}`);
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
  const leaveRoom = () => {
    if (!currentRoomId || !user) return;

    console.log(`Leaving WebRTC room: ${currentRoomId}`);

    // Remove user from room
    const participantRef = ref(
      rtdb,
      `rooms/${currentRoomId}/participants/${user.uid}`
    );
    remove(participantRef);

    // Clean up WebRTC listeners
    cleanupWebRTCListeners();

    // Close all peer connections
    Object.values(peerConnections.current).forEach((pc) => {
      pc.close();
    });

    peerConnections.current = {};
    setPeers([]);
    setCurrentRoomId(null);
    console.log("Dsconnecting fromh here instead");
    setConnectionStatus("disconnected");

    // Stop screen sharing if active
    if (isScreenSharing) {
      toggleScreenShare();
    }

    // Stop recording if active
    if (isRecording) {
      toggleRecording();
    }

    joinAttemptedRef.current = false;
    joinAttemptsRef.current = 0;
    console.log("WebRTC room left successfully");
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
