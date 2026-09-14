// components/Login/LoginPage.tsx - Complete with Role-Based Authentication
import { useState } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { usePoliceAuth } from "@/contexts/PoliceAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ForgotPasswordModal } from "./ForgotPasswordModal";
import { useToast } from "@/hooks/use-toast";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { Shield } from "lucide-react";

export const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { login, isAuthenticated } = usePoliceAuth();

  // Role-based login handling
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

      console.log("Attempting login to:", `${apiUrl}/api/police/login`);

      const response = await fetch(`${apiUrl}/api/police/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      console.log("Login response:", data);

      if (response.ok && data.success) {
        // Store tokens with role information
        const storage = rememberMe ? localStorage : sessionStorage;
        storage.removeItem("policeToken");
        storage.removeItem("police-dashboard-auth");
        storage.setItem("policeToken", data.token);
        const authData = {
          token: data.token,
          police: data.police,
          policeId: data.police.id, // Add this
          officerId: data.police.id, // Keep for compatibility
          role: data.police.role,
          loginTime: Date.now(),
        };
        storage.setItem("police-dashboard-auth", JSON.stringify(authData));
        console.log("=== STORING AUTH DATA ===");
        console.log("authData:", authData);
        console.log(
          "Stored successfully:",
          storage.getItem("police-dashboard-auth")
        );
        console.log("=== END STORAGE ===");
        // Update context
        login(data.token, data.police);

        // Role-based success message
        const roleDisplay =
          data.police.role === "admin_police" ? "Admin" : "Officer";
        toast({
          title: "Login Successful",
          description: `Welcome back, ${roleDisplay} ${data.police.name}!`,
        });

        // Role-based navigation
        console.log("User role:", data.police.role);

        navigate("/dashboard", { replace: true });
      } else {
        console.error("Login failed:", data);
        toast({
          title: "Login Failed",
          description: data.error || "Invalid credentials",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Login Error",
        description: "Cannot connect to server. Please check your connection.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-primary/10 p-4">
      <AutoRefresh />

      <div className="w-full max-w-md space-y-8">
        {/* Safe CheckIn Logo */}
        <div className="text-center">
          <img
            src="/lovable-uploads/9d9969a7-cbda-48a5-a664-db7cd40ca9fa.png"
            alt="Safe CheckIn"
            className="mx-auto h-16 w-auto mb-8"
          />
        </div>

        {/* Login Card */}
        <Card className="bg-gradient-card shadow-card border-0 rounded-2xl">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold text-primary flex items-center justify-center gap-2">
              <Shield className="h-6 w-6" />
              Police Portal
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Secure access for law enforcement personnel
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your official email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl border-2 focus:border-primary"
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl border-2 focus:border-primary"
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) =>
                    setRememberMe(checked as boolean)
                  }
                  className="rounded-md"
                  disabled={isLoading}
                />
                <Label htmlFor="remember" className="text-sm font-medium">
                  Keep me signed in
                </Label>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-primary hover:opacity-90 text-primary-foreground font-semibold py-3 rounded-xl transition-all duration-300 hover:scale-105 shadow-glow"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Authenticating...
                  </div>
                ) : (
                  "Secure Login"
                )}
              </Button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-sm text-primary hover:text-primary-hover underline font-medium transition-colors"
                disabled={isLoading}
              >
                Forgot Password?
              </button>
            </div>

          </CardContent>
        </Card>

        {/* Powered by Deltamarch */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Powered by</p>
          <img
            src="/lovable-uploads/2a19bb73-df31-4860-aae7-1059f90f54b4.png"
            alt="Deltamarch"
            className="mx-auto h-8 w-auto opacity-70"
          />
        </div>

        {/* System Status */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            SafeCheck System Online
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        open={showForgotPassword}
        onOpenChange={setShowForgotPassword}
      />
    </div>
  );
};
