import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, DollarSign, ChevronLeft } from "lucide-react";

type MyBid = {
  id: number;
  auctionId: number;
  amount: string;
  placedAt: string;
};

type MyBidsResponse = {
  bids: MyBid[];
};

export default function InvestorMyBidsPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery<MyBidsResponse>({
    queryKey: ["/api/investor/my-bids"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="page-investor-my-bids">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" data-testid="page-investor-my-bids">
        <Alert variant="destructive">
          <AlertDescription data-testid="error-message">
            Failed to load your bids. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const bids = data?.bids ?? [];

  const totalBidValue = bids.reduce((sum, bid) => sum + Number(bid.amount), 0);

  return (
    <div className="p-6 space-y-6" data-testid="page-investor-my-bids">
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
        <h1 className="text-2xl font-bold" data-testid="text-page-title">My Bids</h1>
        <p className="text-muted-foreground">
          View your bidding history and track your active bids.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card data-testid="card-total-bids">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bids</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-bids">
              {bids.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Bids placed across all auctions
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-bid-value">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bid Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-total-bid-value">
              ${totalBidValue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Combined value of all your bids
            </p>
          </CardContent>
        </Card>
      </div>

      {bids.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium" data-testid="text-no-bids">No Bids Yet</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-2">
              You haven't placed any bids yet. Visit the Exchange to view active auctions 
              and start bidding on bond positions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Bid History
            </CardTitle>
            <CardDescription>
              Your complete bidding history across all auctions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bid ID</TableHead>
                  <TableHead>Auction</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Placed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bids.map((bid) => (
                  <TableRow key={bid.id} data-testid={`row-bid-${bid.id}`}>
                    <TableCell className="font-mono" data-testid={`text-bid-id-${bid.id}`}>
                      #{bid.id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-auction-${bid.id}`}>
                        Auction #{bid.auctionId}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium" data-testid={`text-bid-amount-${bid.id}`}>
                      ${Number(bid.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(bid.placedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
