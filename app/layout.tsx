import type React from "react"
import "./globals.css"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/contexts/auth-context"
import { RoomProvider } from "@/contexts/room-context"
import { WebRTCProvider } from "@/contexts/webrtc-context"
import { ChatProvider } from "@/contexts/chat-context"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Firebase Video Conference",
  description: "A video conference app built with Firebase and WebRTC",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>
            <RoomProvider>
              <WebRTCProvider>
                <ChatProvider>{children}</ChatProvider>
              </WebRTCProvider>
            </RoomProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}


import './globals.css'