"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserOrder } from "@/lib/api";
import { formatINR, roundFinalAmount } from "@/lib/utils";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BillModalProps {
  order: UserOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillModal({ order, open, onOpenChange }: BillModalProps) {
  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  const roundedTotal = roundFinalAmount(order.total);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md print:max-w-none print:w-full print:border-none print:shadow-none print:p-0 print:m-0">
        <DialogHeader className="print:hidden">
          <DialogTitle>Order Bill</DialogTitle>
        </DialogHeader>
        
        {/* Printable Area */}
        <div className="space-y-4 p-4 print:p-8 print:bg-white print:text-black">
          <div className="text-center space-y-1 border-b pb-4">
            <h2 className="text-2xl font-bold font-heading">SliceMatic</h2>
            <p className="text-sm text-muted-foreground print:text-black">Tax Invoice</p>
            <p className="text-sm">Order No: {order.order_no}</p>
            <p className="text-sm">Date: {new Date(order.created_at).toLocaleString()}</p>
          </div>

          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Item</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-right py-2">Price</th>
                  <th className="text-right py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {order.items?.map((item, idx) => (
                  <tr key={idx} className="group">
                    <td className="py-3 pr-2">
                      <div className="font-medium">{item.item_name} {item.size_code && `(${item.size_code})`}</div>
                      {item.toppings_breakdown ? (
                        <div className="mt-1 space-y-0.5">
                          <div className="flex justify-between text-xs text-muted-foreground print:text-black">
                            <span>Base</span>
                            <span>{formatINR(item.base_price || 0)}</span>
                          </div>
                          {item.crust && (
                            <div className="flex justify-between text-xs text-muted-foreground print:text-black">
                              <span>Crust: {item.crust}</span>
                              <span>{formatINR(item.crust_price || 0)}</span>
                            </div>
                          )}
                          {!item.crust && item.item_type && (
                            <div className="text-xs text-muted-foreground print:text-black">Type: {item.item_type}</div>
                          )}
                          {(() => {
                            const toppingCounts = item.toppings_breakdown.reduce((acc, t) => {
                              if (!acc[t.name]) acc[t.name] = { count: 0, price: t.price };
                              acc[t.name].count++;
                              return acc;
                            }, {} as Record<string, { count: number; price: number }>);
                            return Object.entries(toppingCounts).map(([name, { count, price }]) => (
                              <div key={name} className="flex justify-between text-xs text-muted-foreground print:text-black">
                                <span>+ {name} {count > 1 ? `x${count}` : ''}</span>
                                <span>{formatINR(price * count)}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      ) : (
                        <>
                          {item.crust && (
                            <div className="text-xs text-muted-foreground print:text-black">Crust: {item.crust}</div>
                          )}
                          {!item.crust && item.item_type && (
                            <div className="text-xs text-muted-foreground print:text-black">Type: {item.item_type}</div>
                          )}
                          {item.toppings && item.toppings.length > 0 && (
                            <div className="text-xs text-muted-foreground print:text-black">
                              + {item.toppings.join(", ")}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 text-right align-top">{item.quantity}</td>
                    <td className="py-3 text-right align-top">{formatINR(item.unit_price)}</td>
                    <td className="py-3 text-right align-top font-medium">{formatINR(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1.5 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground print:text-black">Subtotal</span>
                <span>{formatINR(order.subtotal)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Discount</span>
                  <span>-{formatINR(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground print:text-black">GST (18%)</span>
                <span>{formatINR(order.gst)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total (Rounded)</span>
                <span>{formatINR(roundedTotal)}</span>
              </div>
            </div>
            
            <div className="text-center pt-8 text-sm text-muted-foreground print:text-black">
              Thank you for dining with SliceMatic!
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t print:hidden">
          <Button onClick={handlePrint} className="gap-2">
            <Download className="size-4" /> Download PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
