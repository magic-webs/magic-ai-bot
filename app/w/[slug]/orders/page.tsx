"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/select-field";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { ReceiptIcon, TrashIcon, EyeIcon } from "@phosphor-icons/react";
import { TableSkeleton } from "@/components/skeletons";

const STATUSES = [
  "new",
  "quoted",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
] as const;
type OrderStatus = (typeof STATUSES)[number];

const STATUS_VARIANT: Record<OrderStatus, "default" | "secondary" | "outline" | "ghost" | "destructive"> = {
  new: "default",
  quoted: "outline",
  confirmed: "outline",
  in_progress: "secondary",
  completed: "secondary",
  cancelled: "destructive",
};

function OrderDetail({ order }: { order: Doc<"orders"> }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label={`View ${order.orderNumber}`}
          >
            <EyeIcon />
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{order.orderNumber}</DialogTitle>
          <DialogDescription>
            Captured from {order.source} on{" "}
            {new Date(order.createdAt).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Customer
            </h3>
            <p className="font-medium">{order.customer.name}</p>
            {order.customer.company ? <p>{order.customer.company}</p> : null}
            {order.customer.email ? (
              <p className="font-mono">{order.customer.email}</p>
            ) : null}
            {order.customer.phone ? (
              <p className="font-mono">{order.customer.phone}</p>
            ) : null}
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Lines
            </h3>
            {order.items.map((item, index) => (
              <div
                key={index}
                className="rounded-md border border-border p-2"
              >
                <p className="font-medium">
                  {item.quantity} × {item.productName}
                  {item.unitPrice !== undefined ? (
                    <span className="ml-2 text-muted-foreground">
                      @ {order.currency ?? ""} {item.unitPrice.toFixed(2)}
                    </span>
                  ) : null}
                </p>
                {item.specs.length > 0 ? (
                  <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                    {item.specs.map((spec) => (
                      <div key={spec.key} className="flex gap-1">
                        <dt className="text-muted-foreground">{spec.key}:</dt>
                        <dd>{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No specifications recorded.
                  </p>
                )}
              </div>
            ))}
          </section>

          {order.delivery ? (
            <>
              <Separator />
              <section className="flex flex-col gap-0.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Delivery
                </h3>
                {order.delivery.address ? <p>{order.delivery.address}</p> : null}
                <p>
                  {[order.delivery.city, order.delivery.postcode, order.delivery.country]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {order.delivery.requiredDate ? (
                  <p className="text-muted-foreground">
                    Required by {order.delivery.requiredDate}
                  </p>
                ) : null}
              </section>
            </>
          ) : null}

          {order.notes ? (
            <>
              <Separator />
              <section className="flex flex-col gap-0.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Notes
                </h3>
                <p>{order.notes}</p>
              </section>
            </>
          ) : null}

          {order.total !== undefined ? (
            <>
              <Separator />
              <p className="text-base font-medium">
                Indicative total from catalogue prices: {order.currency}{" "}
                {order.total.toFixed(2)}
              </p>
            </>
          ) : null}

          {order.rawPayload ? (
            <>
              <Separator />
              <section className="flex flex-col gap-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Raw tool arguments
                </h3>
                <pre className="max-h-52 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
                  {JSON.stringify(JSON.parse(order.rawPayload), null, 2)}
                </pre>
              </section>
            </>
          ) : null}
        </div>

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

export default function OrdersPage() {
  const workspace = useWorkspace();
  const [status, setStatus] = useState<string>("all");
  const orders = useQuery(api.orders.listByWorkspace, {
    workspaceId: workspace._id,
    status: status === "all" ? undefined : (status as OrderStatus),
  });
  const updateStatus = useMutation(api.orders.updateStatus);
  const removeOrder = useMutation(api.orders.remove);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Orders
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Enquiries agents captured, with their specifications. Each one also fired the
            workspace webhook.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="order-status" className="text-sm">
            Status
          </Label>
          <SelectField
            id="order-status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "all", label: "All" },
              ...STATUSES.map((option) => ({
                value: option as string,
                label: option.replace("_", " "),
              })),
            ]}
          />
        </div>
      </header>

      <Separator />

      {orders === undefined ? (
        <TableSkeleton rows={6} columns={5} />
      ) : orders.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptIcon />
            </EmptyMedia>
            <EmptyTitle>No orders yet</EmptyTitle>
            <EmptyDescription>
              Enable the <code>create_order</code> tool on an agent, then run a
              full conversation in the web playground to see one land here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Captured</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order._id}>
                  <TableCell className="font-mono">
                    {order.orderNumber}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{order.customer.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {order.customer.company ??
                          order.customer.phone ??
                          order.customer.email ??
                          ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      {order.items.map((item, index) => (
                        <span key={index}>
                          {item.quantity} × {item.productName}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{order.source}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(order.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={STATUS_VARIANT[order.status]}>
                        {order.status.replace("_", " ")}
                      </Badge>
                      <SelectField
                        size="sm"
                        aria-label={`Change status of ${order.orderNumber}`}
                        value={order.status}
                        onValueChange={async (next) => {
                          await updateStatus({
                            orderId: order._id,
                            status: next as OrderStatus,
                          });
                          toast.add({
                            title: `${order.orderNumber} → ${next}`,
                            type: "success",
                          });
                        }}
                        options={STATUSES.map((option) => ({
                          value: option as string,
                          label: option.replace("_", " "),
                        }))}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <OrderDetail order={order} />
                      <Button
                        size="icon-lg"
                        variant="ghost"
                        aria-label={`Delete ${order.orderNumber}`}
                        onClick={async () => {
                          await removeOrder({ orderId: order._id });
                          toast.add({
                            title: "Order deleted",
                            type: "success",
                          });
                        }}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
