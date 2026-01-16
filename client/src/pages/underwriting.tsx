import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, DollarSign, TrendingUp, Shield, Users, FileText, Calculator, ChevronLeft } from "lucide-react";

interface UnderwritingPartyInput {
  name: string;
  role: "debtor" | "guarantor" | "vassalee" | "other";
  type?: "individual" | "business" | "bank" | "other";
  taxBracketPct?: number | null;
  annualRevenue?: number | null;
  attachedAssetValue?: number | null;
  riskManagementCoverage?: number | null;
  expectedCollectionPct?: number | null;
  notes?: string | null;
}

interface UnderwritingCaseInput {
  title: string;
  primaryDebtorName: string;
  claimAmount: number;
  baseBondAmount?: number | null;
  attachedAssetsValue?: number | null;
  vassaleesAnnualRevenue?: number | null;
  riskManagementCoverage?: number | null;
  finalNoticeToPerfectBondDate?: string | null;
  secondFilingDate?: string | null;
  creditBankingSummary?: string | null;
  addressesSummary?: string | null;
  licensesAndAssociationsSummary?: string | null;
  realEstateSummary?: string | null;
  appraisalSummary?: string | null;
  highestBestUseSummary?: string | null;
  loansAndLiensSummary?: string | null;
  countyFilingsSummary?: string | null;
  secretaryOfStateSummary?: string | null;
  riskManagementNotes?: string | null;
  canPlaceRealEstateLien?: boolean | null;
  canPlaceBusinessLien?: boolean | null;
  notes?: string | null;
}

interface UnderwritingMetrics {
  claimAmount: number;
  baseBondAmount: number | null;
  attachedAssetsValue: number;
  assetRecoveryPct: number;
  estimatedAssetRecovery: number;
  vassaleesAnnualRevenue: number;
  revenueRecoveryPct: number;
  estimatedRevenueRecovery: number;
  riskManagementCoverage: number;
  insuranceRecoveryPct: number;
  estimatedInsuranceRecovery: number;
  estimatedTotalRecovery: number;
  partiesCount: number;
  averagePartyCollectionPct: number | null;
  totalMultiPartyClaims: number;
  estimatedCollectionFromParties: number;
  collectionAsPctOfClaim: number | null;
  isCollectionGreaterThanClaim: boolean | null;
}

interface UnderwritingCase {
  id: number;
  title: string;
  primaryDebtorName: string;
  claimAmount: number;
  baseBondAmount?: number | null;
  attachedAssetsValue?: number | null;
  vassaleesAnnualRevenue?: number | null;
  riskManagementCoverage?: number | null;
  finalNoticeToPerfectBondDate?: string | null;
  secondFilingDate?: string | null;
  creditBankingSummary?: string | null;
  addressesSummary?: string | null;
  licensesAndAssociationsSummary?: string | null;
  realEstateSummary?: string | null;
  appraisalSummary?: string | null;
  highestBestUseSummary?: string | null;
  loansAndLiensSummary?: string | null;
  countyFilingsSummary?: string | null;
  secretaryOfStateSummary?: string | null;
  riskManagementNotes?: string | null;
  canPlaceRealEstateLien?: boolean | null;
  canPlaceBusinessLien?: boolean | null;
  notes?: string | null;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function computePreviewMetrics(caseInput: UnderwritingCaseInput, parties: UnderwritingPartyInput[]): UnderwritingMetrics {
  const claimAmount = Number(caseInput.claimAmount) || 0;
  const baseBondAmount = caseInput.baseBondAmount ? Number(caseInput.baseBondAmount) : null;
  const attachedAssetsValue = Number(caseInput.attachedAssetsValue) || 0;
  const vassaleesAnnualRevenue = Number(caseInput.vassaleesAnnualRevenue) || 0;
  const riskManagementCoverage = Number(caseInput.riskManagementCoverage) || 0;

  const assetRecoveryPct = 0.5;
  const revenueRecoveryPct = 0.5;
  const insuranceRecoveryPct = 0.5;

  const estimatedAssetRecovery = attachedAssetsValue * assetRecoveryPct;
  const estimatedRevenueRecovery = vassaleesAnnualRevenue * revenueRecoveryPct;
  const estimatedInsuranceRecovery = riskManagementCoverage * insuranceRecoveryPct;
  const estimatedTotalRecovery = estimatedAssetRecovery + estimatedRevenueRecovery + estimatedInsuranceRecovery;

  const partiesCount = parties.length;
  const collectionPcts = parties
    .map(p => p.expectedCollectionPct != null ? Number(p.expectedCollectionPct) : null)
    .filter((v): v is number => v !== null);

  let averagePartyCollectionPct: number | null = null;
  if (collectionPcts.length > 0) {
    averagePartyCollectionPct = collectionPcts.reduce((a, b) => a + b, 0) / collectionPcts.length;
  } else {
    averagePartyCollectionPct = 50;
  }

  const totalMultiPartyClaims = claimAmount * partiesCount;
  const estimatedCollectionFromParties = totalMultiPartyClaims * (averagePartyCollectionPct / 100);
  const collectionAsPctOfClaim = claimAmount > 0 ? estimatedCollectionFromParties / claimAmount : null;
  const isCollectionGreaterThanClaim = collectionAsPctOfClaim !== null ? collectionAsPctOfClaim >= 1 : null;

  return {
    claimAmount,
    baseBondAmount,
    attachedAssetsValue,
    assetRecoveryPct,
    estimatedAssetRecovery,
    vassaleesAnnualRevenue,
    revenueRecoveryPct,
    estimatedRevenueRecovery,
    riskManagementCoverage,
    insuranceRecoveryPct,
    estimatedInsuranceRecovery,
    estimatedTotalRecovery,
    partiesCount,
    averagePartyCollectionPct,
    totalMultiPartyClaims,
    estimatedCollectionFromParties,
    collectionAsPctOfClaim,
    isCollectionGreaterThanClaim,
  };
}

export default function UnderwritingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"create" | "saved">("create");

  const [caseInput, setCaseInput] = useState<UnderwritingCaseInput>({
    title: "",
    primaryDebtorName: "",
    claimAmount: 0,
  });

  const [parties, setParties] = useState<UnderwritingPartyInput[]>([]);

  const { data: savedCases = [] } = useQuery<UnderwritingCase[]>({
    queryKey: ["/api/underwriting/cases"],
    enabled: activeView === "saved",
  });

  const createCaseMutation = useMutation({
    mutationFn: async (data: { caseInput: UnderwritingCaseInput; parties: UnderwritingPartyInput[] }) => {
      return await apiRequest("/api/underwriting/cases", "POST", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Underwriting case created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/underwriting/cases"] });
      setCaseInput({ title: "", primaryDebtorName: "", claimAmount: 0 });
      setParties([]);
      setActiveView("saved");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create case", variant: "destructive" });
    },
  });

  const metrics = computePreviewMetrics(caseInput, parties);

  const addParty = () => {
    setParties([...parties, { name: "", role: "debtor" }]);
  };

  const removeParty = (index: number) => {
    setParties(parties.filter((_, i) => i !== index));
  };

  const updateParty = (index: number, field: string, value: any) => {
    const updated = [...parties];
    updated[index] = { ...updated[index], [field]: value };
    setParties(updated);
  };

  const handleSubmit = () => {
    if (!caseInput.title || !caseInput.primaryDebtorName || !caseInput.claimAmount) {
      toast({ title: "Validation Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createCaseMutation.mutate({ caseInput, parties });
  };

  const formatCurrency = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div className="min-h-screen bg-background">
      <div className="p-6 max-w-7xl mx-auto space-y-6">
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
            <h1 className="text-3xl font-bold tracking-tight">Underwriting</h1>
            <p className="text-muted-foreground mt-1">Multi-party judgment debt risk assessment</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={activeView === "create" ? "default" : "outline"}
              onClick={() => setActiveView("create")}
              data-testid="button-view-create"
            >
              <FileText className="h-4 w-4 mr-2" />
              Create Case
            </Button>
            <Button
              variant={activeView === "saved" ? "default" : "outline"}
              onClick={() => setActiveView("saved")}
              data-testid="button-view-saved"
            >
              <Calculator className="h-4 w-4 mr-2" />
              Saved Cases
            </Button>
          </div>
        </div>

        {activeView === "create" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <Card data-testid="card-case-details">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Case Details
                  </CardTitle>
                  <CardDescription>Basic information about the underwriting case</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="title">Case Title *</Label>
                    <Input
                      id="title"
                      data-testid="input-title"
                      value={caseInput.title}
                      onChange={(e) => setCaseInput({ ...caseInput, title: e.target.value })}
                      placeholder="e.g., Smith Judgment Bond 2024"
                    />
                  </div>
                  <div>
                    <Label htmlFor="primaryDebtorName">Primary Debtor *</Label>
                    <Input
                      id="primaryDebtorName"
                      data-testid="input-primary-debtor"
                      value={caseInput.primaryDebtorName}
                      onChange={(e) => setCaseInput({ ...caseInput, primaryDebtorName: e.target.value })}
                      placeholder="Name of primary debtor"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="claimAmount">Claim Amount *</Label>
                      <Input
                        id="claimAmount"
                        type="number"
                        data-testid="input-claim-amount"
                        value={caseInput.claimAmount || ""}
                        onChange={(e) => setCaseInput({ ...caseInput, claimAmount: Number(e.target.value) })}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="baseBondAmount">Base Bond Amount</Label>
                      <Input
                        id="baseBondAmount"
                        type="number"
                        data-testid="input-base-bond-amount"
                        value={caseInput.baseBondAmount || ""}
                        onChange={(e) => setCaseInput({ ...caseInput, baseBondAmount: Number(e.target.value) || null })}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-recovery-sources">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Recovery Sources (50% Rules)
                  </CardTitle>
                  <CardDescription>Assets, revenue, and insurance coverage</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="attachedAssetsValue">Attached Assets Value</Label>
                    <Input
                      id="attachedAssetsValue"
                      type="number"
                      data-testid="input-attached-assets"
                      value={caseInput.attachedAssetsValue || ""}
                      onChange={(e) => setCaseInput({ ...caseInput, attachedAssetsValue: Number(e.target.value) || null })}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="vassaleesAnnualRevenue">Vassalees' Annual Revenue</Label>
                    <Input
                      id="vassaleesAnnualRevenue"
                      type="number"
                      data-testid="input-vassalees-revenue"
                      value={caseInput.vassaleesAnnualRevenue || ""}
                      onChange={(e) => setCaseInput({ ...caseInput, vassaleesAnnualRevenue: Number(e.target.value) || null })}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="riskManagementCoverage">Risk Management Coverage</Label>
                    <Input
                      id="riskManagementCoverage"
                      type="number"
                      data-testid="input-risk-management-coverage"
                      value={caseInput.riskManagementCoverage || ""}
                      onChange={(e) => setCaseInput({ ...caseInput, riskManagementCoverage: Number(e.target.value) || null })}
                      placeholder="0.00"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-parties">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Parties ({parties.length})
                    </div>
                    <Button size="sm" onClick={addParty} data-testid="button-add-party">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Party
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-96">
                    {parties.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-parties">
                        No parties added yet
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {parties.map((party, idx) => (
                          <Card key={idx} data-testid={`card-party-${idx}`}>
                            <CardContent className="pt-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <Label className="font-semibold">Party {idx + 1}</Label>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeParty(idx)}
                                  data-testid={`button-remove-party-${idx}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                  <Label>Name</Label>
                                  <Input
                                    value={party.name}
                                    onChange={(e) => updateParty(idx, "name", e.target.value)}
                                    placeholder="Party name"
                                    data-testid={`input-party-name-${idx}`}
                                  />
                                </div>
                                <div>
                                  <Label>Role</Label>
                                  <Select value={party.role} onValueChange={(v) => updateParty(idx, "role", v)}>
                                    <SelectTrigger data-testid={`select-party-role-${idx}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="debtor">Debtor</SelectItem>
                                      <SelectItem value="guarantor">Guarantor</SelectItem>
                                      <SelectItem value="vassalee">Vassalee</SelectItem>
                                      <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label>Type</Label>
                                  <Select value={party.type || ""} onValueChange={(v) => updateParty(idx, "type", v || null)}>
                                    <SelectTrigger data-testid={`select-party-type-${idx}`}>
                                      <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="individual">Individual</SelectItem>
                                      <SelectItem value="business">Business</SelectItem>
                                      <SelectItem value="bank">Bank</SelectItem>
                                      <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label>Expected Collection %</Label>
                                  <Input
                                    type="number"
                                    value={party.expectedCollectionPct ?? ""}
                                    onChange={(e) => updateParty(idx, "expectedCollectionPct", Number(e.target.value) || null)}
                                    placeholder="50"
                                    data-testid={`input-party-collection-${idx}`}
                                  />
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card data-testid="card-metrics">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Computed Metrics
                  </CardTitle>
                  <CardDescription>Real-time preview based on input</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Claim Amount</p>
                      <p className="text-lg font-semibold" data-testid="text-metric-claim">{formatCurrency(metrics.claimAmount)}</p>
                    </div>
                    {metrics.baseBondAmount && (
                      <div>
                        <p className="text-sm text-muted-foreground">Base Bond</p>
                        <p className="text-lg font-semibold" data-testid="text-metric-base-bond">{formatCurrency(metrics.baseBondAmount)}</p>
                      </div>
                    )}
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Recovery Analysis
                    </h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Assets ({formatPercent(metrics.assetRecoveryPct)})</span>
                        <span className="font-medium" data-testid="text-metric-asset-recovery">{formatCurrency(metrics.estimatedAssetRecovery)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Revenue ({formatPercent(metrics.revenueRecoveryPct)})</span>
                        <span className="font-medium" data-testid="text-metric-revenue-recovery">{formatCurrency(metrics.estimatedRevenueRecovery)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Insurance ({formatPercent(metrics.insuranceRecoveryPct)})</span>
                        <span className="font-medium" data-testid="text-metric-insurance-recovery">{formatCurrency(metrics.estimatedInsuranceRecovery)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Total Recovery</span>
                        <span className="font-bold text-lg text-primary" data-testid="text-metric-total-recovery">{formatCurrency(metrics.estimatedTotalRecovery)}</span>
                      </div>
                    </div>
                  </div>

                  {parties.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h4 className="font-semibold mb-3">Multi-Party Collection</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Parties Count</span>
                            <span data-testid="text-metric-parties-count">{metrics.partiesCount}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Avg Collection %</span>
                            <span data-testid="text-metric-avg-collection">{metrics.averagePartyCollectionPct?.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Party Claims</span>
                            <span data-testid="text-metric-total-party-claims">{formatCurrency(metrics.totalMultiPartyClaims)}</span>
                          </div>
                          <div className="flex justify-between font-semibold">
                            <span>Estimated Collection</span>
                            <span data-testid="text-metric-estimated-collection">{formatCurrency(metrics.estimatedCollectionFromParties)}</span>
                          </div>
                          {metrics.collectionAsPctOfClaim !== null && (
                            <div className="mt-2">
                              <Badge
                                variant={metrics.isCollectionGreaterThanClaim ? "default" : "secondary"}
                                data-testid="badge-collection-status"
                              >
                                {metrics.isCollectionGreaterThanClaim
                                  ? `✓ Collection exceeds claim (${formatPercent(metrics.collectionAsPctOfClaim)})`
                                  : `Collection below claim (${formatPercent(metrics.collectionAsPctOfClaim)})`}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-qualitative">
                <CardHeader>
                  <CardTitle>Qualitative Notes</CardTitle>
                  <CardDescription>Additional underwriting details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label htmlFor="creditBankingSummary">Credit/Banking Summary</Label>
                    <Textarea
                      id="creditBankingSummary"
                      value={caseInput.creditBankingSummary || ""}
                      onChange={(e) => setCaseInput({ ...caseInput, creditBankingSummary: e.target.value || null })}
                      placeholder="Credit history and banking relationships"
                      rows={2}
                      data-testid="textarea-credit-banking"
                    />
                  </div>
                  <div>
                    <Label htmlFor="realEstateSummary">Real Estate Summary</Label>
                    <Textarea
                      id="realEstateSummary"
                      value={caseInput.realEstateSummary || ""}
                      onChange={(e) => setCaseInput({ ...caseInput, realEstateSummary: e.target.value || null })}
                      placeholder="Real estate holdings and valuations"
                      rows={2}
                      data-testid="textarea-real-estate"
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="canPlaceRealEstateLien"
                        checked={caseInput.canPlaceRealEstateLien || false}
                        onCheckedChange={(checked) => setCaseInput({ ...caseInput, canPlaceRealEstateLien: !!checked })}
                        data-testid="checkbox-real-estate-lien"
                      />
                      <Label htmlFor="canPlaceRealEstateLien" className="text-sm">Can Place RE Lien</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="canPlaceBusinessLien"
                        checked={caseInput.canPlaceBusinessLien || false}
                        onCheckedChange={(checked) => setCaseInput({ ...caseInput, canPlaceBusinessLien: !!checked })}
                        data-testid="checkbox-business-lien"
                      />
                      <Label htmlFor="canPlaceBusinessLien" className="text-sm">Can Place Business Lien</Label>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="notes">General Notes</Label>
                    <Textarea
                      id="notes"
                      value={caseInput.notes || ""}
                      onChange={(e) => setCaseInput({ ...caseInput, notes: e.target.value || null })}
                      placeholder="Additional notes and observations"
                      rows={3}
                      data-testid="textarea-general-notes"
                    />
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={createCaseMutation.isPending}
                data-testid="button-save-case"
              >
                {createCaseMutation.isPending ? "Saving..." : "Save Underwriting Case"}
              </Button>
            </div>
          </div>
        ) : (
          <Card data-testid="card-saved-cases">
            <CardHeader>
              <CardTitle>Saved Underwriting Cases</CardTitle>
              <CardDescription>Previously created underwriting analyses</CardDescription>
            </CardHeader>
            <CardContent>
              {savedCases.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-saved-cases">
                  No saved cases yet
                </p>
              ) : (
                <div className="space-y-4">
                  {savedCases.map((c: any) => (
                    <Card key={c.id} data-testid={`card-saved-case-${c.id}`}>
                      <CardHeader>
                        <CardTitle className="text-lg">{c.caseInput?.title || "Untitled"}</CardTitle>
                        <CardDescription>
                          Debtor: {c.caseInput?.primaryDebtorName} | Claim: {formatCurrency(c.metrics?.claimAmount || 0)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Total Recovery</p>
                            <p className="font-semibold" data-testid={`text-saved-recovery-${c.id}`}>
                              {formatCurrency(c.metrics?.estimatedTotalRecovery || 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Parties</p>
                            <p className="font-semibold" data-testid={`text-saved-parties-${c.id}`}>
                              {c.parties?.length || 0}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Created</p>
                            <p className="font-semibold">{new Date(c.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        {c.narrative && (
                          <>
                            <Separator />
                            <div>
                              <p className="text-sm font-semibold mb-1">AI Narrative:</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid={`text-narrative-${c.id}`}>
                                {c.narrative}
                              </p>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
