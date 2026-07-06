"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { API_BASE, ApiError } from "@/lib/api";
import { formatINR } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface RefundData {
  id: string;
  order_id: string;
  order_no: string;
  customer_name: string;
  customer_id: string;
  reason: string;
  status: string;
  refund_amount: number;
  admin_response: string | null;
  requested_at: string;
}

export default function RefundsPage() {
  const [refunds, setRefunds] = useState<RefundData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const token = useAuthStore((s) => s.token);
  const [activeRefund, setActiveRefund] = useState<RefundData | null>(null);
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [adminResponse, setAdminResponse] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchRefunds();
  }, [token]);

  const fetchRefunds = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/refunds`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to load refunds");
      setRefunds(data.refunds || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async () => {
    if (!activeRefund) return;
    if (actionType === "REJECT" && !adminResponse.trim()) {
      alert("A reason is required to reject a refund.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/refunds/${activeRefund.id}/${actionType.toLowerCase()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ admin_response: adminResponse || "Refund Approved." })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Action failed");
      
      // Update local state
      setRefunds((prev) =>
        prev.map((r) => (r.id === activeRefund.id ? { ...r, ...data.refund } : r))
      );
      setActiveRefund(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-heading">Refund Requests</h1>
      </div>

      {error ? (
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">{error}</div>
      ) : loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-24 rounded-lg bg-surface-2" />
          <div className="h-24 rounded-lg bg-surface-2" />
        </div>
      ) : refunds.length === 0 ? (
        <p className="text-muted-foreground">No refund requests found.</p>
      ) : (
        <div className="grid gap-4">
          {refunds.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">Order #{r.order_no}</h3>
                  <p className="text-sm text-muted-foreground">
                    Customer: {r.customer_name || "Guest"} • {new Date(r.requested_at).toLocaleString()}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Reason: </span>
                    {r.reason}
                  </p>
                  {r.admin_response && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Admin: {r.admin_response}
                    </p>
                  )}
                </div>
                <div className="text-right space-y-2">
                  <div className="font-bold text-xl">{formatINR(r.refund_amount)}</div>
                  <Badge variant={r.status === "REQUESTED" ? "secondary" : r.status === "APPROVED" ? "success" : "destructive"}>
                    {r.status}
                  </Badge>
                  {r.status === "REQUESTED" && (
                    <div className="flex gap-2 justify-end mt-2">
                      <Button size="sm" variant="outline" className="text-destructive border-destructive hover:bg-destructive hover:text-white" onClick={() => { setActiveRefund(r); setActionType("REJECT"); setAdminResponse(""); }}>
                        Reject
                      </Button>
                      <Button size="sm" variant="default" className="bg-primary" onClick={() => { setActiveRefund(r); setActionType("APPROVE"); setAdminResponse("Refund Approved."); }}>
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!activeRefund} onOpenChange={(open) => !open && setActiveRefund(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "APPROVE" ? "Approve Refund" : "Reject Refund"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Order: <strong>{activeRefund?.order_no}</strong> <br />
              Amount: <strong>{activeRefund && formatINR(activeRefund.refund_amount)}</strong>
            </p>
            <Textarea
              placeholder={actionType === "REJECT" ? "Reason for rejection (Required)..." : "Optional approval note..."}
              value={adminResponse}
              onChange={(e) => setAdminResponse(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setActiveRefund(null)}>Cancel</Button>
              <Button variant={actionType === "REJECT" ? "destructive" : "default"} onClick={handleAction} disabled={actionLoading}>
                {actionLoading ? "Processing..." : `Confirm ${actionType}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
