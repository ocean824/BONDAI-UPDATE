import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, Clock, Calendar, ChevronLeft } from "lucide-react";

type OverviewTotals = {
  totals: {
    next7Days: number;
    next30Days: number;
    later: number;
  };
};

export default function InvestorOverviewPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery<OverviewTotals>({
    queryKey: ["/api/investor/overview"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="page-investor-overview">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" data-testid="page-investor-overview">
        <Alert variant="destructive">
          <AlertDescription data-testid="error-message">
            Failed to load investor overview. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const totals = data?.totals ?? { next7Days: 0, next30Days: 0, later: 0 };
  const totalValue = totals.next7Days + totals.next30Days + totals.later;

  return (
    <div className="p-6 space-y-6" data-testid="page-investor-overview">
      {/* Back Navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/")}
          className="gap-1 pl-0 hover:pl-1 transition-all"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Bond Exchange Overview</h1>
        <p className="text-muted-foreground">
          Aggregated totals of bonds expected to become available for investment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card data-testid="card-next-7-days">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Within 7 Days</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-7day-value">
              ${totals.next7Days.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Expected face value of bonds perfecting soon
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-next-30-days">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Within 30 Days</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-30day-value">
              ${totals.next30Days.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Upcoming bonds in the next month
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-later">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Later</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-later-value">
              ${totals.later.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Bonds expected beyond 30 days
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-total-pipeline">
        <CardHeader>
          <CardTitle>Total Investment Pipeline</CardTitle>
          <CardDescription>
            Combined value of all upcoming bonds across all time periods
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold font-mono" data-testid="text-total-value">
            ${totalValue.toLocaleString()}
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          This screen shows only aggregate totals. Individual bond details are not exposed to 
          investors until bonds become perfected and enter the auction process.
        </AlertDescription>
      </Alert>
    </div>
  );
}
