"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserOrder, API_BASE, ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/utils";

interface RefundModalProps {
  order: UserOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RefundModal({ order, open, onOpenChange }: RefundModalProps) {
  const [loading, setLoading] = useState(false);
  const [refundStatus, setRefundStatus] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (open && order) {
      setReason("");
      setError("");
      // Fetch refund status
      fetch(`${API_BASE}/api/orders/${order.order_no}/refund`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && data.refund) {
            setRefundStatus(data.refund);
          } else {
            setRefundStatus(null);
          }
        })
        .catch(() => setRefundStatus(null));
    }
  }, [open, order, token]);

  if (!order) return null;

  const isEligible = () => {
    const created = new Date(order.created_at);
    const now = new Date();
    const diffHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
    return diffHours <= 24;
  };

  const eligible = isEligible();

  const handleSubmit = async () => {
    if (!reason.trim()) {
      setError("Please provide a reason for the refund.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/orders/${order.order_no}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          customer_id: user?.id || "",
          reason: reason,
          refund_amount: order.total,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.errors?.time || data.errors?.db || data.errors?.order || "Failed to submit refund request.");
      }
      setRefundStatus(data.refund);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request Full Refund</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Order: <span className="font-medium text-foreground">{order.order_no}</span><br/>
            Amount: <span className="font-medium text-foreground">{formatINR(order.total)}</span>
          </p>

          {refundStatus ? (
            <div className="space-y-3 rounded-lg border p-4 bg-surface-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Status</span>
                <Badge variant={refundStatus.status === "REQUESTED" ? "secondary" : refundStatus.status === "APPROVED" ? "default" : "destructive"}>
                  {refundStatus.status}
                </Badge>
              </div>
              <div className="text-sm">
                <p className="text-muted-foreground">Your Reason:</p>
                <p>{refundStatus.reason}</p>
              </div>
              {refundStatus.admin_response && (
                <div className="text-sm pt-2 border-t mt-2">
                  <p className="text-muted-foreground">Admin Response:</p>
                  <p>{refundStatus.admin_response}</p>
                </div>
              )}
            </div>
          ) : !eligible ? (
            <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
              Refunds can only be requested within 24 hours of placing the order.
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                placeholder="Please tell us why you are requesting a refund..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={handleSubmit} disabled={loading || !reason.trim()} className="w-full">
                {loading ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
