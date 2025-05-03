"use client";

import type React from "react";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useRoom } from "@/contexts/room-context";
import { useWebRTC } from "@/contexts/webrtc-context";
import { useChat } from "@/contexts/chat-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Mic,
  MicOff,
  VideoIcon,
  VideoOff,
  PhoneOff,
  MonitorSmartphone,
  Users,
  MessageSquare,
  VideoIcon as VideoRecorder,
  Loader2,
  AlertTriangle,
  X,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const {
    currentRoom,
    joinRoom,
    leaveRoom,
    isJoiningRoom,
    joinError,
    getRoom,
  } = useRoom();
  const {
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
    joinRoom: joinWebRTCRoom,
    leaveRoom: leaveWebRTCRoom,
    currentRoomId,
    recordingURL,
    webRTCError,
    clearWebRTCError,
    isScreenShareSupported,
    reinitializeMedia,
    mediaState,
    setSelectedVideoDevice,
    setSelectedAudioDevice,
    reconnectPeers,
    connectionStatus,
  } = useWebRTC();
  const { messages, sendMessage, setRoomId } = useChat();
  const [message, setMessage] = useState("");
  const router = useRouter();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isJoining, setIsJoining] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const setupCompletedRef = useRef(false);
  const setupStartedRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const [isVerifyingRoom, setIsVerifyingRoom] = useState(true);
  const [roomExists, setRoomExists] = useState(false);
  const [roomData, setRoomData] = useState<any>(null);
  const [isMediaSettingsOpen, setIsMediaSettingsOpen] = useState(false);
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [webRTCErrorState, setWebRTCError] = useState<string | null>(null);

  // Store the room ID in a ref to avoid dependency issues
  useEffect(() => {
    if (id) {
      roomIdRef.current = id as string;
      console.log("Room ID set from params:", id);
    }
  }, [id]);

  // First, verify that the room exists
  useEffect(() => {
    const verifyRoom = async () => {
      if (!roomIdRef.current || !user) return;

      setIsVerifyingRoom(true);
      try {
        console.log(`Verifying room exists: ${roomIdRef.current}`);
        const room = await getRoom(roomIdRef.current);

        if (room) {
          console.log(`Room verified: ${room.name}`, room);
          setRoomExists(true);
          setRoomData(room);
        } else {
          console.log(`Room not found: ${roomIdRef.current}`);
          setRoomExists(false);
          setSetupError(`Room ${roomIdRef.current} not found`);
        }
      } catch (error) {
        console.error("Error verifying room:", error);
        setRoomExists(false);
        setSetupError("Error verifying room");
      } finally {
        setIsVerifyingRoom(false);
      }
    };

    if (roomIdRef.current && user && !authLoading) {
      verifyRoom();
    }
  }, [getRoom, user, authLoading]);

  // Setup room function
  const setupRoom = useCallback(async () => {
    // Skip if already completed or started or room doesn't exist
    if (
      setupCompletedRef.current ||
      setupStartedRef.current ||
      !roomIdRef.current ||
      !user ||
      !roomExists
    ) {
      console.log("Returning with params:", {
        setupCompleted: setupCompletedRef.current,
        setupStarted: setupStartedRef.current,
        roomId: roomIdRef.current,
        user: user,
        roomExists: roomExists,
      });
      return;
    }

    const roomId = roomIdRef.current;
    console.log(`Starting room setup for room: ${roomId}`);

    // Mark setup as started to prevent multiple attempts
    setupStartedRef.current = true;
    setIsJoining(true);
    setSetupError(null);

    try {
      // Step 1: Join the room
      console.log("Step 1: Joining room...");
      await joinRoom(roomId);
      console.log("Room joined successfully");

      // Step 2: Set up WebRTC
      console.log("Step 2: Setting up WebRTC...");
      await joinWebRTCRoom(roomId, currentRoom);
      console.log("WebRTC room joined successfully");

      // Step 3: Set up chat
      console.log("Step 3: Setting up chat...");
      setRoomId(roomId);
      console.log("Chat room set successfully");

      // Mark setup as completed
      setupCompletedRef.current = true;
      console.log("Room setup completed successfully");
    } catch (error: any) {
      console.error("Error during room setup:", error);
      setSetupError(error.message || "Failed to set up room");

      // If there's an error, navigate back to dashboard after a delay
      setTimeout(() => {
        if (router) {
          console.log("Navigating back to dashboard due to setup error");
          router.replace("/dashboard");
        }
      }, 3000);
    } finally {
      setIsJoining(false);
      setupStartedRef.current = false;
    }
  }, [user, joinRoom, joinWebRTCRoom, setRoomId, router, roomExists]);

  // Effect to check if user is logged in
  useEffect(() => {
    if (authLoading) {
      console.log("Auth is still loading, waiting...");
      return;
    }

    if (!user) {
      console.log("No user found, redirecting to login");
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  // Separate effect for room setup
  useEffect(() => {
    if (authLoading || isVerifyingRoom) {
      console.log("Still loading, waiting for setup...");
      return;
    }

    if (
      user &&
      roomIdRef.current &&
      roomExists &&
      !setupCompletedRef.current &&
      !setupStartedRef.current
    ) {
      console.log("Starting room setup...");
      setupRoom();
    }

    // Cleanup function
    return () => {
      if (setupCompletedRef.current) {
        console.log("Cleaning up room page");
        // leaveWebRTCRoom();
        // leaveRoom();
        // setRoomId(null);
      }
    };
  }, [
    user,
    authLoading,
    setupRoom,
    leaveWebRTCRoom,
    leaveRoom,
    setRoomId,
    isVerifyingRoom,
    roomExists,
  ]);

  // Effect to update local video
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);
  console.log("localstream:", localStream);

  // Effect to scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMessage(message);
      setMessage("");
    }
  };

  const handleLeaveRoom = () => {
    setupCompletedRef.current = false;
    setupStartedRef.current = false;
    leaveWebRTCRoom();
    leaveRoom();
    router.replace("/dashboard");
  };

  // Safely handle screen sharing toggle with error handling
  const handleScreenShareToggle = async () => {
    try {
      await toggleScreenShare();
    } catch (error) {
      console.error("Error toggling screen share:", error);
    }
  };

  // Handle media refresh
  const handleRefreshMedia = async () => {
    setIsRefreshingMedia(true);
    try {
      const success = await reinitializeMedia();
      if (!success) {
        setWebRTCError(
          "Failed to reinitialize media. Please check your camera and microphone permissions."
        );
      }
    } catch (error) {
      console.error("Error refreshing media:", error);
      setWebRTCError(
        "An error occurred while refreshing media. Please try again."
      );
    } finally {
      setIsRefreshingMedia(false);
    }
  };

  // Handle reconnect
  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await reconnectPeers(roomIdRef.current!);
    } catch (error) {
      console.error("Error reconnecting:", error);
      setWebRTCError(
        "Failed to reconnect. Please try again or rejoin the meeting."
      );
    } finally {
      setIsReconnecting(false);
    }
  };

  // Get connection status badge
  const getConnectionStatusBadge = () => {
    switch (connectionStatus) {
      case "connected":
        return (
          <Badge
            variant="outline"
            className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
          >
            <Wifi className="h-3 w-3 mr-1" />
            Connected
          </Badge>
        );
      case "connecting":
        return (
          <Badge
            variant="outline"
            className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
          >
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Connecting
          </Badge>
        );
      case "disconnected":
        return (
          <Badge
            variant="outline"
            className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
          >
            <WifiOff className="h-3 w-3 mr-1" />
            Disconnected
          </Badge>
        );
      case "failed":
        return (
          <Badge
            variant="outline"
            className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Connection Failed
          </Badge>
        );
      default:
        return null;
    }
  };

  // Show loading state while auth is being determined
  if (authLoading || isVerifyingRoom) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Loading...</h2>
          <p className="text-muted-foreground">
            {isVerifyingRoom
              ? "Verifying meeting room..."
              : "Checking your authentication status..."}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Please log in</h2>
          <p className="text-muted-foreground">
            You need to be logged in to join a meeting
          </p>
          <Button className="mt-4" onClick={() => router.push("/login")}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  if (!roomExists) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Room not found</h2>
          <p className="text-muted-foreground mb-6">
            The meeting you're trying to join doesn't exist or has been deleted
          </p>
          <Button className="mt-4" onClick={() => router.replace("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (isJoining || isJoiningRoom) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">
            Setting up your meeting...
          </h2>
          <p className="text-muted-foreground">
            Please wait while we connect you
          </p>
        </div>
      </div>
    );
  }

  if (setupError || joinError) {
    const error = setupError || joinError;
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error joining meeting</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button
            className="w-full"
            onClick={() => router.replace("/dashboard")}
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Use roomData if currentRoom is not available yet
  const displayRoom = currentRoom || roomData;

  if (!displayRoom) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Room not found</h2>
          <p className="text-muted-foreground">
            The meeting you're trying to join doesn't exist or has been deleted
          </p>
          <Button className="mt-4" onClick={() => router.replace("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Calculate grid layout
  const totalParticipants = peers.length + 1; // Including local user
  let gridCols = 1;

  if (totalParticipants === 1) {
    gridCols = 1;
  } else if (totalParticipants <= 4) {
    gridCols = 2;
  } else {
    gridCols = 3;
  }
  console.log("PEERS:", peers);
  console.log("error:", webRTCError);
  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      {webRTCError && (
        <div className="fixed top-4 right-4 z-50 max-w-md bg-destructive text-destructive-foreground p-4 rounded-lg shadow-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-sm">Error</h3>
              <p className="text-xs mt-1">{webRTCError}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full -mt-1 -mr-1 text-destructive-foreground/80 hover:text-destructive-foreground"
              onClick={clearWebRTCError}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>
      )}

      <header className="fixed top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-xl">{displayRoom.name}</h1>
            {isRecording && (
              <div className="flex items-center gap-1 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-2 py-1 rounded-md text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                Recording
              </div>
            )}
            <div className="ml-2">{getConnectionStatusBadge()}</div>
          </div>
          <div className="flex items-center gap-2">
            {(connectionStatus === "disconnected" ||
              connectionStatus === "failed") && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReconnect}
                disabled={isReconnecting}
                className="text-yellow-600 border-yellow-300 bg-yellow-50 hover:bg-yellow-100 dark:text-yellow-400 dark:border-yellow-800 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/30"
              >
                {isReconnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Reconnecting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reconnect
                  </>
                )}
              </Button>
            )}
            <Dialog
              open={isMediaSettingsOpen}
              onOpenChange={setIsMediaSettingsOpen}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" title="Media Settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Media Settings</DialogTitle>
                  <DialogDescription>
                    Configure your camera and microphone settings
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="camera">Camera</Label>
                    <Select
                      value={mediaState.selectedVideoDevice || ""}
                      onValueChange={(value) => setSelectedVideoDevice(value)}
                      disabled={mediaState.videoDevices.length === 0}
                    >
                      <SelectTrigger id="camera">
                        <SelectValue
                          placeholder={
                            mediaState.videoDevices.length === 0
                              ? "No cameras found"
                              : "Select camera"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {mediaState.videoDevices.map((device) => (
                          <SelectItem
                            key={device.deviceId}
                            value={device.deviceId}
                          >
                            {device.label ||
                              `Camera ${device.deviceId.substring(0, 5)}...`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="microphone">Microphone</Label>
                    <Select
                      value={mediaState.selectedAudioDevice || ""}
                      onValueChange={(value) => setSelectedAudioDevice(value)}
                      disabled={mediaState.audioDevices.length === 0}
                    >
                      <SelectTrigger id="microphone">
                        <SelectValue
                          placeholder={
                            mediaState.audioDevices.length === 0
                              ? "No microphones found"
                              : "Select microphone"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {mediaState.audioDevices.map((device) => (
                          <SelectItem
                            key={device.deviceId}
                            value={device.deviceId}
                          >
                            {device.label ||
                              `Microphone ${device.deviceId.substring(
                                0,
                                5
                              )}...`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Media Status</Label>
                    <div className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            mediaState.hasVideo ? "bg-green-500" : "bg-red-500"
                          }`}
                        ></div>
                        <span>
                          Camera:{" "}
                          {mediaState.hasVideo ? "Connected" : "Not connected"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            mediaState.hasAudio ? "bg-green-500" : "bg-red-500"
                          }`}
                        ></div>
                        <span>
                          Microphone:{" "}
                          {mediaState.hasAudio ? "Connected" : "Not connected"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Connection Status</Label>
                    <div className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            connectionStatus === "connected"
                              ? "bg-green-500"
                              : connectionStatus === "connecting"
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          }`}
                        ></div>
                        <span>
                          WebRTC:{" "}
                          {connectionStatus.charAt(0).toUpperCase() +
                            connectionStatus.slice(1)}
                          {connectionStatus !== "connected" && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 ml-2 text-xs"
                              onClick={handleReconnect}
                              disabled={isReconnecting}
                            >
                              {isReconnecting ? "Reconnecting..." : "Reconnect"}
                            </Button>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            peers.length > 0 ? "bg-green-500" : "bg-yellow-500"
                          }`}
                        ></div>
                        <span>Peers: {peers.length} connected</span>
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    onClick={handleRefreshMedia}
                    disabled={isRefreshingMedia}
                  >
                    {isRefreshingMedia ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh Media
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button variant="destructive" size="sm" onClick={handleLeaveRoom}>
              <PhoneOff className="mr-2 h-4 w-4" />
              Leave
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <div className="h-full p-4">
            <div
              className={`grid h-full gap-4 grid-cols-1 md:grid-cols-${gridCols}`}
            >
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                {!mediaState.hasVideo && !mediaState.hasAudio && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-white">
                    <AlertTriangle className="h-12 w-12 mb-2 text-yellow-400" />
                    <p className="text-center px-4">
                      No camera or microphone detected
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 bg-gray-700 hover:bg-gray-600 text-white"
                      onClick={() => setIsMediaSettingsOpen(true)}
                    >
                      Configure Media
                    </Button>
                  </div>
                )}

                {mediaState.hasVideo && (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                )}

                {!mediaState.hasVideo && mediaState.hasAudio && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-white">
                    <div className="text-center">
                      <Avatar className="h-24 w-24 mx-auto">
                        <AvatarFallback className="text-3xl">
                          {user.displayName?.charAt(0) || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <p className="mt-4">{user.displayName || "You"}</p>
                      <p className="text-xs mt-1 text-gray-400">Audio only</p>
                    </div>
                  </div>
                )}

                <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded text-white text-xs flex items-center gap-1">
                  <span>You</span>
                  {!isAudioEnabled && (
                    <MicOff className="h-3 w-3 text-red-400" />
                  )}
                  {!mediaState.hasVideo && (
                    <VideoOff className="h-3 w-3 text-red-400" />
                  )}
                </div>

                {/* Media status indicators */}
                <div className="absolute top-2 right-2 flex gap-1">
                  {!mediaState.hasVideo && (
                    <div className="bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center">
                      <VideoOff className="h-3 w-3 mr-1" />
                      <span>No camera</span>
                    </div>
                  )}
                  {!mediaState.hasAudio && (
                    <div className="bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center">
                      <MicOff className="h-3 w-3 mr-1" />
                      <span>No microphone</span>
                    </div>
                  )}
                </div>

                {/* Refresh media button */}
                {(!mediaState.hasVideo || !mediaState.hasAudio) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 right-2"
                    onClick={handleRefreshMedia}
                    disabled={isRefreshingMedia}
                  >
                    {isRefreshingMedia ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span className="ml-1">
                      {isRefreshingMedia ? "Refreshing..." : "Refresh"}
                    </span>
                  </Button>
                )}
              </div>

              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="relative aspect-video bg-black rounded-lg overflow-hidden"
                >
                  {peer.stream ? (
                    <PeerVideo key={peer.id} stream={peer.stream} />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gray-800 text-white">
                      <div className="text-center">
                        <Avatar className="h-20 w-20 mx-auto">
                          <AvatarFallback>
                            {peer.displayName.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <p className="mt-2">{peer.displayName}</p>
                        <p className="text-xs mt-1 text-gray-400">
                          Connecting...
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded text-white text-xs">
                    {peer.displayName}
                  </div>
                </div>
              ))}

              {/* Show empty participant slots with connection status when no peers */}
              {peers.length === 0 && (
                <div className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center text-white">
                  <div className="text-center">
                    <Users className="h-16 w-16 mx-auto mb-4 text-gray-600" />
                    <h3 className="text-lg font-medium">Waiting for others</h3>
                    <p className="text-sm text-gray-400 mt-2">
                      {connectionStatus === "connected"
                        ? "You're the only one here"
                        : connectionStatus === "connecting"
                        ? "Establishing connection..."
                        : "Connection issue. Try reconnecting"}
                    </p>
                    {(connectionStatus === "disconnected" ||
                      connectionStatus === "failed") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReconnect}
                        disabled={isReconnecting}
                        className="mt-4 bg-gray-700 hover:bg-gray-600 text-white"
                      >
                        {isReconnecting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Reconnecting...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reconnect
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="w-80 border-l bg-background hidden md:block">
          <Tabs defaultValue="chat">
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">
                <MessageSquare className="mr-2 h-4 w-4" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="participants" className="flex-1">
                <Users className="mr-2 h-4 w-4" />
                Participants ({Object.keys(displayRoom.participants).length})
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="chat"
              className="flex flex-col h-[calc(100vh-8rem)]"
            >
              <ScrollArea className="flex-1 p-4">
                {messages.length > 0 ? (
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${
                          msg.userId === user.uid
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-3 py-2 ${
                            msg.userId === user.uid
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          {msg.userId !== user.uid && (
                            <div className="text-xs font-medium mb-1">
                              {msg.userName}
                            </div>
                          )}
                          <div className="break-words">{msg.text}</div>
                          <div className="text-xs opacity-70 mt-1 text-right">
                            {formatDistanceToNow(msg.timestamp, {
                              addSuffix: true,
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <MessageSquare className="h-8 w-8 text-muted-foreground mb-2" />
                    <h3 className="text-lg font-medium">No messages yet</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Send a message to start the conversation
                    </p>
                  </div>
                )}
              </ScrollArea>

              <form onSubmit={handleSendMessage} className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1"
                  />
                  <Button type="submit" size="icon">
                    <MessageSquare className="h-4 w-4" />
                    <span className="sr-only">Send</span>
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="participants" className="h-[calc(100vh-8rem)]">
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  <div className="font-medium">
                    Participants ({Object.keys(displayRoom.participants).length}
                    )
                  </div>
                  <div className="space-y-2">
                    {/* Local user */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            {user.displayName?.charAt(0) || "U"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="text-sm font-medium">
                            {user.displayName || "You"} (You)
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {mediaState.hasAudio ? (
                              <span className="flex items-center">
                                <Mic className="h-3 w-3 mr-1" />
                                {isAudioEnabled ? "Unmuted" : "Muted"}
                              </span>
                            ) : (
                              <span className="flex items-center text-red-400">
                                <MicOff className="h-3 w-3 mr-1" />
                                No Audio
                              </span>
                            )}
                            {mediaState.hasVideo ? (
                              <span className="flex items-center">
                                <VideoIcon className="h-3 w-3 mr-1" />
                                {isVideoEnabled ? "Video on" : "Video off"}
                              </span>
                            ) : (
                              <span className="flex items-center text-red-400">
                                <VideoOff className="h-3 w-3 mr-1" />
                                No Video
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Remote participants */}
                    {Object.entries(displayRoom.participants)
                      .filter(([id]) => id !== user.uid)
                      .map(([id, participant]: [string, any]) => (
                        <div
                          key={id}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback>
                                {participant.displayName.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="text-sm font-medium">
                                {participant.displayName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Joined{" "}
                                {formatDistanceToNow(participant.joined, {
                                  addSuffix: true,
                                })}
                              </div>
                            </div>
                          </div>
                          <div>
                            {peers.find((p) => p.id === id)?.stream ? (
                              <Badge
                                variant="outline"
                                className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs"
                              >
                                Connected
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs"
                              >
                                Connecting
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <div className="container flex items-center justify-center gap-2">
          <Button
            variant={isAudioEnabled ? "outline" : "destructive"}
            size="icon"
            onClick={toggleAudio}
            className="rounded-full h-12 w-12"
            disabled={!mediaState.hasAudio}
            title={
              !mediaState.hasAudio
                ? "No microphone detected"
                : isAudioEnabled
                ? "Mute"
                : "Unmute"
            }
          >
            {isAudioEnabled ? (
              <Mic className="h-5 w-5" />
            ) : (
              <MicOff className="h-5 w-5" />
            )}
            <span className="sr-only">
              {isAudioEnabled ? "Mute" : "Unmute"}
            </span>
          </Button>

          <Button
            variant={isVideoEnabled ? "outline" : "destructive"}
            size="icon"
            onClick={toggleVideo}
            className="rounded-full h-12 w-12"
            disabled={!mediaState.hasVideo}
            title={
              !mediaState.hasVideo
                ? "No camera detected"
                : isVideoEnabled
                ? "Turn off camera"
                : "Turn on camera"
            }
          >
            {isVideoEnabled ? (
              <VideoIcon className="h-5 w-5" />
            ) : (
              <VideoOff className="h-5 w-5" />
            )}
            <span className="sr-only">
              {isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            </span>
          </Button>

          <Button
            variant={isScreenSharing ? "destructive" : "outline"}
            size="icon"
            onClick={handleScreenShareToggle}
            className={`rounded-full h-12 w-12 ${
              !isScreenShareSupported ? "opacity-50 cursor-not-allowed" : ""
            }`}
            disabled={!isScreenShareSupported}
            title={
              !isScreenShareSupported
                ? "Screen sharing is not supported in this preview environment"
                : isScreenSharing
                ? "Stop sharing screen"
                : "Share screen"
            }
          >
            <MonitorSmartphone className="h-5 w-5" />
            <span className="sr-only">
              {isScreenSharing ? "Stop sharing" : "Share screen"}
            </span>
          </Button>

          <Button
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            onClick={toggleRecording}
            className="rounded-full h-12 w-12"
            disabled={!mediaState.hasAudio && !mediaState.hasVideo}
            title={
              !mediaState.hasAudio && !mediaState.hasVideo
                ? "Need camera or microphone to record"
                : isRecording
                ? "Stop recording"
                : "Start recording"
            }
          >
            <VideoRecorder className="h-5 w-5" />
            <span className="sr-only">
              {isRecording ? "Stop recording" : "Start recording"}
            </span>
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsMediaSettingsOpen(true)}
            className="rounded-full h-12 w-12"
            title="Media settings"
          >
            <Settings className="h-5 w-5" />
            <span className="sr-only">Media settings</span>
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={handleLeaveRoom}
            className="rounded-full h-12 w-12"
          >
            <PhoneOff className="h-5 w-5" />
            <span className="sr-only">Leave meeting</span>
          </Button>
        </div>
      </div>

      {recordingURL && (
        <div className="fixed bottom-20 right-4 bg-background border rounded-lg shadow-lg p-4 max-w-sm">
          <h4 className="font-medium mb-2">Recording saved</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Your recording has been saved to Firebase Storage.
          </p>
          <div className="flex justify-end">
            <a href={recordingURL} target="_blank" rel="noopener noreferrer">
              <Button size="sm">View Recording</Button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

const PeerVideo = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  console.log("stream here:", stream);

  useEffect(() => {
    if (videoRef.current && stream) {
      // Check if stream has video tracks
      const hasVideoTrack = stream.getVideoTracks().length > 0;

      if (hasVideoTrack) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((error) => {
          console.error("Error playing video:", error);
        });
      }
    }

    // Cleanup the stream when component is unmounted or stream changes
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="h-full w-full object-cover"
    />
  );
};
