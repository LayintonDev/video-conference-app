"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRoom } from "@/contexts/room-context";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Video,
  Plus,
  Users,
  Clock,
  LogOut,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function DashboardPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { rooms, createRoom, joinRoom, isJoiningRoom, joinError } = useRoom();
  const [newRoomName, setNewRoomName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Don't redirect while auth is loading
  useEffect(() => {
    if (!authLoading && !user) {
      console.log("No user found, redirecting to login");
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      console.log("Creating new room:", newRoomName);
      const roomId = await createRoom(newRoomName);
      console.log("Room created successfully, ID:", roomId);
      setIsDialogOpen(false);

      // Add a longer delay to ensure the room is created in Firebase
      setTimeout(() => {
        console.log("Navigating to room:", roomId);
        router.push(`/room/${roomId}`);
      }, 1000);
    } catch (error: any) {
      console.error("Error creating room:", error);
      setError(error.message || "Failed to create room");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    if (isJoiningRoom) return;

    setJoiningRoomId(roomId);
    setError(null);
    try {
      console.log("Joining room:", roomId);
      await joinRoom(roomId);

      // Add a longer delay to ensure the room is joined in Firebase
      setTimeout(() => {
        console.log("Navigating to room:", roomId);
        router.push(`/room/${roomId}`);
      }, 1000);
    } catch (error: any) {
      console.error("Error joining room:", error);
      setError(error.message || "Failed to join room");
      setJoiningRoomId(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace("/");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Show loading state while auth is being determined
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Loading...</h2>
          <p className="text-muted-foreground">
            Please wait while we load your dashboard
          </p>
        </div>
      </div>
    );
  }

  // If not loading and no user, don't render anything (redirect will happen)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl">
            <Video className="h-6 w-6" />
            <span>Firebase Video Conference</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.displayName || user.email}
            </span>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="h-5 w-5" />
              <span className="sr-only">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="container py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Your Meetings</h1>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Meeting
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateRoom}>
                <DialogHeader>
                  <DialogTitle>Create New Meeting</DialogTitle>
                  <DialogDescription>
                    Give your meeting a name to help others identify it.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Label htmlFor="room-name">Meeting Name</Label>
                  <Input
                    id="room-name"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="Team Standup"
                    className="mt-2"
                    required
                  />
                </div>
                {error && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Meeting"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {(joinError || error) && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{joinError || error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {rooms.length > 0 ? (
            rooms.map((room) => (
              <Card key={room.id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle>{room.name}</CardTitle>
                  <CardDescription className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Created{" "}
                    {formatDistanceToNow(room.createdAt, { addSuffix: true })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-2">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>
                      {Object.keys(room.participants || {}).length} participant
                      {Object.keys(room.participants || {}).length !== 1
                        ? "s"
                        : ""}
                    </span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    onClick={() => handleJoinRoom(room.id)}
                    disabled={isJoiningRoom || joiningRoomId === room.id}
                  >
                    {joiningRoomId === room.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Joining...
                      </>
                    ) : (
                      "Join Meeting"
                    )}
                  </Button>
                </CardFooter>
              </Card>
            ))
          ) : (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-primary/10 p-3 mb-4">
                <Video className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-medium">No meetings found</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Create a new meeting to get started
              </p>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    New Meeting
                  </Button>
                </DialogTrigger>
              </Dialog>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
