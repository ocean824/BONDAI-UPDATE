import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Gavel, Clock, DollarSign, ChevronLeft } from "lucide-react";

type Auction = {
  id: number;
  status: string;
  startsAt: string;
  endsAt: string;
  reservePrice: string;
};

type AuctionsResponse = {
  auctions: Auction[];
};

export default function InvestorExchangePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedAuction, setSelectedAuction] = useState<Auction | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidDialogOpen, setBidDialogOpen] = useState(false);

  const { data, isLoading, error } = useQuery<AuctionsResponse>({
    queryKey: ["/api/investor/auctions"],
  });

  const placeBidMutation = useMutation({
    mutationFn: async ({ auctionId, amount }: { auctionId: number; amount: number }) => {
      return await apiRequest(`/api/investor/auctions/${auctionId}/bids`, "POST", { amount });
    },
    onSuccess: (response: any) => {
      toast({
        title: "Bid Placed",
        description: response.message || "Your bid has been placed successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/investor/auctions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investor/my-bids"] });
      setBidDialogOpen(false);
      setBidAmount("");
      setSelectedAuction(null);
    },
    onError: (error: any) => {
      toast({
        title: "Bid Failed",
        description: error.message || "Failed to place bid. Please try again.",
        variant: "destructive",
      });
    },
  });

  const timeRemaining = (endsAt: string) => {
    const end = new Date(endsAt).getTime();
    const now = Date.now();
    const diff = end - now;
    
    if (diff <= 0) return "Ended";
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const handlePlaceBid = () => {
    if (!selectedAuction) return;
    const amount = parseFloat(bidAmount);
    
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid positive bid amount.",
        variant: "destructive",
      });
      return;
    }

    placeBidMutation.mutate({ auctionId: selectedAuction.id, amount });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="page-investor-exchange">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" data-testid="page-investor-exchange">
        <Alert variant="destructive">
          <AlertDescription data-testid="error-message">
            Failed to load auctions. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const auctions = data?.auctions ?? [];

  return (
    <div className="p-6 space-y-6" data-testid="page-investor-exchange">
      {/* Back Navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/exchange/overview")}
          className="gap-1 pl-0 hover:pl-1 transition-all"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Exchange Overview
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Bond Exchange</h1>
        <p className="text-muted-foreground">
          Active auctions for perfected bonds. Place bids to acquire bond positions.
        </p>
      </div>

      {auctions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Gavel className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium" data-testid="text-no-auctions">No Active Auctions</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-2">
              There are no active auctions at the moment. Check back later for new opportunities.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gavel className="h-5 w-5" />
              Active Auctions
            </CardTitle>
            <CardDescription>
              {auctions.length} auction{auctions.length !== 1 ? "s" : ""} currently open for bidding
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Auction ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ends At</TableHead>
                  <TableHead>Time Left</TableHead>
                  <TableHead className="text-right">Reserve Price</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auctions.map((auction) => (
                  <TableRow key={auction.id} data-testid={`row-auction-${auction.id}`}>
                    <TableCell className="font-mono" data-testid={`text-auction-id-${auction.id}`}>
                      #{auction.id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" data-testid={`badge-status-${auction.id}`}>
                        {auction.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(auction.endsAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{timeRemaining(auction.endsAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-reserve-${auction.id}`}>
                      ${Number(auction.reservePrice).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedAuction(auction);
                          setBidDialogOpen(true);
                        }}
                        data-testid={`button-bid-${auction.id}`}
                      >
                        Place Bid
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={bidDialogOpen} onOpenChange={setBidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Place Bid
            </DialogTitle>
            <DialogDescription>
              {selectedAuction && (
                <>
                  Auction #{selectedAuction.id} - Reserve Price: $
                  {Number(selectedAuction.reservePrice).toLocaleString()}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Bid Amount ($)</label>
              <Input
                type="number"
                placeholder="Enter your bid amount"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                data-testid="input-bid-amount"
              />
              <p className="text-xs text-muted-foreground">
                Your bid must exceed the current highest bid by at least $1.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBidDialogOpen(false);
                setBidAmount("");
                setSelectedAuction(null);
              }}
              data-testid="button-cancel-bid"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePlaceBid}
              disabled={placeBidMutation.isPending}
              data-testid="button-submit-bid"
            >
              {placeBidMutation.isPending ? "Placing Bid..." : "Submit Bid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
