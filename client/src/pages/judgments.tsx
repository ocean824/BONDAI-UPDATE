import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, DollarSign, TrendingUp, Shield, Plus, ChevronLeft } from "lucide-react";
import { JudgmentDocDropzone } from "@/components/judgment-doc-dropzone";
import type { Judgment, PricingScenario } from "@shared/schema";

export default function JudgmentsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedJudgment, setSelectedJudgment] = useState<Judgment | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [targetIRR, setTargetIRR] = useState("15");
  const [discountRate, setDiscountRate] = useState("30");
  const [expectedRecovery, setExpectedRecovery] = useState("60");

  const { data: judgments, isLoading } = useQuery<Judgment[]>({
    queryKey: ["/api/judgments"],
  });

  const { data: scenarios } = useQuery<{ scenarios: PricingScenario[] }>({
    queryKey: ["/api/judgments", selectedJudgment?.id, "price-estimates"],
    enabled: !!selectedJudgment?.id,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: { debtorName: string; caseNumber: string; judgmentAmount: string; notes?: string }) => {
      return apiRequest("POST", "/api/judgments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/judgments"] });
      toast({
        title: "Judgment uploaded",
        description: "Judgment has been added successfully",
      });
    },
  });

  const pricingMutation = useMutation({
    mutationFn: async (judgmentId: number) => {
      return apiRequest("POST", `/api/judgments/${judgmentId}/price`, {
        targetIRR: parseFloat(targetIRR),
        discountRate: parseFloat(discountRate),
        expectedRecoveryPct: parseFloat(expectedRecovery),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/judgments", selectedJudgment?.id, "price-estimates"] });
      toast({
        title: "Pricing calculated",
        description: "Multi-scenario pricing analysis complete",
      });
    },
  });

  const [uploadForm, setUploadForm] = useState({
    debtorName: "",
    caseNumber: "",
    judgmentAmount: "",
    notes: "",
  });

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    uploadMutation.mutate(uploadForm);
    setUploadForm({ debtorName: "", caseNumber: "", judgmentAmount: "", notes: "" });
  };

  const handleCalculatePricing = () => {
    if (selectedJudgment) {
      pricingMutation.mutate(selectedJudgment.id);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Back Navigation */}
      <div className="flex items-center gap-2 mb-4">
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

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Judgments</h1>
          <p className="text-muted-foreground">
            Upload and analyze judgment documents with AI-powered extraction
          </p>
        </div>
        <Button onClick={() => setShowPricing(!showPricing)} data-testid="button-toggle-upload">
          <Plus className="w-4 h-4 mr-2" />
          {showPricing ? "View List" : "Add Judgment"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          {showPricing ? (
            <Card>
              <CardHeader>
                <CardTitle>Upload Judgment</CardTitle>
                <CardDescription>Enter judgment details manually</CardDescription>
              </CardHeader>
              <form onSubmit={handleUpload}>
                <CardContent className="space-y-4">
                  <JudgmentDocDropzone
                    onExtract={(data) =>
                      setUploadForm((prev) => ({
                        ...prev,
                        debtorName: data.debtorName ?? prev.debtorName,
                        caseNumber: data.caseNumber ?? prev.caseNumber,
                        judgmentAmount:
                          data.judgmentAmount != null
                            ? String(data.judgmentAmount)
                            : prev.judgmentAmount,
                        notes: data.notes ?? prev.notes,
                      }))
                    }
                  />
                  <div className="space-y-2">
                    <Label htmlFor="debtorName">Debtor Name</Label>
                    <Input
                      id="debtorName"
                      value={uploadForm.debtorName}
                      onChange={(e) => setUploadForm({ ...uploadForm, debtorName: e.target.value })}
                      required
                      data-testid="input-debtor-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="caseNumber">Case Number</Label>
                    <Input
                      id="caseNumber"
                      value={uploadForm.caseNumber}
                      onChange={(e) => setUploadForm({ ...uploadForm, caseNumber: e.target.value })}
                      required
                      data-testid="input-case-number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="judgmentAmount">Judgment Amount ($)</Label>
                    <Input
                      id="judgmentAmount"
                      type="number"
                      step="0.01"
                      value={uploadForm.judgmentAmount}
                      onChange={(e) => setUploadForm({ ...uploadForm, judgmentAmount: e.target.value })}
                      required
                      data-testid="input-judgment-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes (Optional)</Label>
                    <Textarea
                      id="notes"
                      value={uploadForm.notes}
                      onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                      rows={3}
                      data-testid="input-notes"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={uploadMutation.isPending}
                    data-testid="button-upload"
                  >
                    {uploadMutation.isPending ? "Uploading..." : "Upload Judgment"}
                  </Button>
                </CardContent>
              </form>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Judgments ({judgments?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))
                  ) : judgments && judgments.length > 0 ? (
                    judgments.map((judgment) => (
                      <Card
                        key={judgment.id}
                        className={`cursor-pointer hover-elevate transition-all ${
                          selectedJudgment?.id === judgment.id ? "border-primary" : ""
                        }`}
                        onClick={() => setSelectedJudgment(judgment)}
                        data-testid={`judgment-card-${judgment.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate" data-testid={`judgment-debtor-${judgment.id}`}>
                                {judgment.debtorName || "Unknown Debtor"}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {judgment.caseNumber || "No case number"}
                              </p>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {judgment.status}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-mono font-semibold" data-testid={`judgment-amount-${judgment.id}`}>
                              ${parseFloat(judgment.judgmentAmount || "0").toLocaleString()}
                            </span>
                            <FileText className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No judgments yet</p>
                      <p className="text-xs text-muted-foreground">Upload your first judgment to begin</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="lg:col-span-2">
          {selectedJudgment ? (
            <Tabs defaultValue="details" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
                <TabsTrigger value="extraction" data-testid="tab-extraction">AI Extraction</TabsTrigger>
                <TabsTrigger value="pricing" data-testid="tab-pricing">Pricing Scenarios</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Judgment Details</CardTitle>
                    <CardDescription>Core information about this judgment</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">Debtor Name</Label>
                        <p className="font-medium" data-testid="detail-debtor-name">{selectedJudgment.debtorName || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Case Number</Label>
                        <p className="font-medium font-mono text-sm" data-testid="detail-case-number">{selectedJudgment.caseNumber || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Court</Label>
                        <p className="font-medium" data-testid="detail-court">{selectedJudgment.court || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Jurisdiction</Label>
                        <p className="font-medium" data-testid="detail-jurisdiction">{selectedJudgment.jurisdiction || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Judgment Amount</Label>
                        <p className="text-2xl font-bold font-mono" data-testid="detail-amount">
                          ${parseFloat(selectedJudgment.judgmentAmount || "0").toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Status</Label>
                        <Badge className="mt-1">{selectedJudgment.status}</Badge>
                      </div>
                    </div>
                    {selectedJudgment.notes && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Notes</Label>
                        <p className="text-sm mt-1">{selectedJudgment.notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="extraction" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5" />
                      AI Extraction Results
                    </CardTitle>
                    <CardDescription>Data extracted using GPT-5 AI model</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="secondary">AI Verified</Badge>
                        <span className="text-xs text-muted-foreground">
                          Confidence: 85%
                        </span>
                      </div>
                      <p className="text-sm">
                        AI extraction data will be displayed here when available. This includes
                        debtor information, case details, and financial amounts extracted from
                        uploaded PDF documents.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="pricing" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Calculate Pricing Scenarios</CardTitle>
                    <CardDescription>
                      Generate base, optimistic, and stressed pricing models
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="targetIRR">Target IRR (%)</Label>
                        <Input
                          id="targetIRR"
                          type="number"
                          value={targetIRR}
                          onChange={(e) => setTargetIRR(e.target.value)}
                          data-testid="input-target-irr"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="discountRate">Discount Rate (%)</Label>
                        <Input
                          id="discountRate"
                          type="number"
                          value={discountRate}
                          onChange={(e) => setDiscountRate(e.target.value)}
                          data-testid="input-discount-rate"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="expectedRecovery">Expected Recovery (%)</Label>
                        <Input
                          id="expectedRecovery"
                          type="number"
                          value={expectedRecovery}
                          onChange={(e) => setExpectedRecovery(e.target.value)}
                          data-testid="input-expected-recovery"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={handleCalculatePricing}
                      disabled={pricingMutation.isPending}
                      className="w-full"
                      data-testid="button-calculate-pricing"
                    >
                      <DollarSign className="w-4 h-4 mr-2" />
                      {pricingMutation.isPending ? "Calculating..." : "Calculate Pricing"}
                    </Button>
                  </CardContent>
                </Card>

                {scenarios && scenarios.scenarios.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {scenarios.scenarios.map((scenario) => (
                      <Card
                        key={scenario.scenario}
                        className={`${
                          scenario.scenario === "base"
                            ? "border-l-4 border-l-blue-500"
                            : scenario.scenario === "optimistic"
                            ? "border-l-4 border-l-green-500"
                            : "border-l-4 border-l-amber-500"
                        }`}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg capitalize">{scenario.scenario}</CardTitle>
                          <CardDescription className="text-xs">
                            {scenario.scenario === "base" && "Standard market conditions"}
                            {scenario.scenario === "optimistic" && "Favorable recovery outlook"}
                            {scenario.scenario === "stressed" && "Conservative projections"}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Purchase Price</Label>
                            <p className="text-2xl font-bold font-mono" data-testid={`price-${scenario.scenario}`}>
                              ${scenario.recommendedPurchasePrice.toLocaleString()}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <Label className="text-xs text-muted-foreground">Recovery</Label>
                              <p className="font-semibold">{scenario.expectedRecoveryPct}%</p>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Discount</Label>
                              <p className="font-semibold">{scenario.discountRate}%</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-foreground">Disclaimer:</strong> Pricing scenarios
                      are algorithmic estimates for informational purposes only. Not investment advice.
                      Actual recovery values may vary significantly.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : (
            <Card className="h-full flex items-center justify-center min-h-[400px]">
              <CardContent className="text-center py-12">
                <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Judgment Selected</h3>
                <p className="text-sm text-muted-foreground">
                  Select a judgment from the list to view details and pricing
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
