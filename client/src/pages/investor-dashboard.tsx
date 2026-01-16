import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, DollarSign, Package, FileText, Shield, ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InvestorMetrics } from "@shared/schema";

export default function InvestorDashboardPage() {
  const [, setLocation] = useLocation();
  const { data: metrics, isLoading } = useQuery<InvestorMetrics>({
    queryKey: ["/api/metrics"],
  });

  const heroMetrics = [
    {
      title: "Total Face Value",
      value: `$${(metrics?.totalFaceValue || 0).toLocaleString()}`,
      description: "Aggregate judgment amounts",
      icon: DollarSign,
      iconColor: "text-green-600",
      iconBg: "bg-green-100 dark:bg-green-900/20",
      testId: "metric-total-face",
    },
    {
      title: "Recommended Purchase",
      value: `$${(metrics?.totalRecommendedPurchase || 0).toLocaleString()}`,
      description: "Estimated acquisition cost",
      icon: TrendingUp,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-100 dark:bg-blue-900/20",
      testId: "metric-recommended-purchase",
    },
    {
      title: "Total Judgments",
      value: metrics?.totalJudgments || 0,
      description: "Portfolio size",
      icon: FileText,
      iconColor: "text-purple-600",
      iconBg: "bg-purple-100 dark:bg-purple-900/20",
      testId: "metric-total-judgments",
    },
    {
      title: "Average Recovery",
      value: `${(metrics?.averageRecovery || 0).toFixed(1)}%`,
      description: "Expected recovery rate",
      icon: Package,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100 dark:bg-amber-900/20",
      testId: "metric-average-recovery",
    },
  ];

  const trancheData = [
    {
      name: "Senior Tranche",
      tranche: "senior",
      color: "border-l-blue-500",
      bgColor: "bg-blue-50 dark:bg-blue-950/20",
      data: metrics?.trancheBreakdown?.senior || { count: 0, faceValue: 0, recommendedPurchase: 0 },
      description: "Low risk, priority repayment",
    },
    {
      name: "Mezzanine Tranche",
      tranche: "mezz",
      color: "border-l-amber-500",
      bgColor: "bg-amber-50 dark:bg-amber-950/20",
      data: metrics?.trancheBreakdown?.mezz || { count: 0, faceValue: 0, recommendedPurchase: 0 },
      description: "Balanced risk-return profile",
    },
    {
      name: "Equity Tranche",
      tranche: "equity",
      color: "border-l-green-500",
      bgColor: "bg-green-50 dark:bg-green-950/20",
      data: metrics?.trancheBreakdown?.equity || { count: 0, faceValue: 0, recommendedPurchase: 0 },
      description: "Higher risk, upside potential",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Investor Metrics</h1>
          <p className="text-muted-foreground">
            Comprehensive portfolio analytics and tranche breakdowns
          </p>
        </div>
        <Badge variant="secondary" className="gap-2">
          <Shield className="w-3 h-3" />
          AI-Powered Analysis
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {heroMetrics.map((metric) => (
          <Card key={metric.title} className="hover-elevate transition-all">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <div className="flex-1">
                <CardDescription className="text-xs uppercase tracking-wide mb-1">
                  {metric.title}
                </CardDescription>
              </div>
              <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${metric.iconBg}`}>
                <metric.icon className={`w-6 h-6 ${metric.iconColor}`} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-10 w-32" />
              ) : (
                <div>
                  <div className="text-4xl font-bold font-mono mb-1" data-testid={metric.testId}>
                    {metric.value}
                  </div>
                  <p className="text-xs text-muted-foreground">{metric.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Tranche Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {trancheData.map(({ name, tranche, color, bgColor, data, description }) => (
            <Card key={tranche} className={`border-l-4 ${color}`}>
              <CardHeader className={`${bgColor} pb-4`}>
                <CardTitle className="text-lg">{name}</CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                        Judgments
                      </Label>
                      <p className="text-3xl font-bold font-mono" data-testid={`${tranche}-count`}>
                        {data.count}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                        Face Value
                      </Label>
                      <p className="text-2xl font-bold font-mono" data-testid={`${tranche}-face-value`}>
                        ${(data.faceValue || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                        Est. Purchase Price
                      </Label>
                      <p className="text-2xl font-bold font-mono" data-testid={`${tranche}-purchase`}>
                        {data.recommendedPurchase !== null && data.recommendedPurchase !== undefined 
                          ? `$${data.recommendedPurchase.toLocaleString()}`
                          : <span className="text-muted-foreground text-sm">No pricing data</span>
                        }
                      </p>
                    </div>
                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Discount</Label>
                        <p className="text-sm font-semibold">
                          {data.faceValue > 0 && data.recommendedPurchase !== null && data.recommendedPurchase !== undefined
                            ? (((data.faceValue - data.recommendedPurchase) / data.faceValue) * 100).toFixed(1)
                            : "N/A"}%
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Composition</CardTitle>
            <CardDescription>Distribution across risk tranches</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Senior</span>
                    <span className="font-semibold">
                      {metrics?.totalJudgments
                        ? ((metrics.trancheBreakdown.senior.count / metrics.totalJudgments) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{
                        width: metrics?.totalJudgments
                          ? `${(metrics.trancheBreakdown.senior.count / metrics.totalJudgments) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Mezzanine</span>
                    <span className="font-semibold">
                      {metrics?.totalJudgments
                        ? ((metrics.trancheBreakdown.mezz.count / metrics.totalJudgments) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{
                        width: metrics?.totalJudgments
                          ? `${(metrics.trancheBreakdown.mezz.count / metrics.totalJudgments) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Equity</span>
                    <span className="font-semibold">
                      {metrics?.totalJudgments
                        ? ((metrics.trancheBreakdown.equity.count / metrics.totalJudgments) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{
                        width: metrics?.totalJudgments
                          ? `${(metrics.trancheBreakdown.equity.count / metrics.totalJudgments) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Profile Summary</CardTitle>
            <CardDescription>Portfolio risk characteristics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-sm font-medium">Senior Tranche</span>
              </div>
              <Badge variant="secondary">Low Risk</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-sm font-medium">Mezzanine Tranche</span>
              </div>
              <Badge variant="secondary">Medium Risk</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 dark:bg-green-950/20">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium">Equity Tranche</span>
              </div>
              <Badge variant="secondary">High Risk</Badge>
            </div>
            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground">
                Diversification across risk tranches helps balance portfolio returns while
                managing downside exposure.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-muted/50">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium mb-1">Investment Disclaimer</p>
              <p className="text-xs text-muted-foreground">
                All metrics, valuations, and recovery estimates are AI-generated projections for
                informational purposes only. These do not constitute investment advice. Actual
                recovery rates, timelines, and returns may vary significantly from estimates.
                Consult qualified legal and financial professionals before making investment
                decisions in judgment debt portfolios.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}
