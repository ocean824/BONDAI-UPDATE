import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  Building2,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Plus,
  RefreshCw,
  Lock,
  ChevronLeft,
} from "lucide-react";

type SuretyTrust = {
  id: number;
  name: string;
  trustType: string;
  canActAsSurety: boolean;
  allowedBondTypes: string[];
  maxSingleBondLimit: string;
  aggregateBondLimit: string;
  currentExposure: string;
  requiresInsuranceAbove: string;
  notes: string | null;
  createdAt: string;
};

type SuretyCase = {
  id: number;
  bondId: number;
  suretyTrustId: number;
  status: string;
  bondType: string;
  bondPenalSum: string;
  principalId: number | null;
  principalRiskScore: string | null;
  collateralRequiredAmount: string;
  collateralTypeAllowed: string[];
  indemnityRequired: string;
  insuranceRequired: string;
  underwriterUserId: number | null;
  decisionAt: string | null;
  notes: string | null;
  createdAt: string;
};

type Bond = {
  id: number;
  name: string;
  faceValue: string | null;
  status: string;
  suretyStatus: string | null;
};

function authHeaders(pin?: string): HeadersInit {
  const token = localStorage.getItem("auth_token");
  const headers: HeadersInit = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (pin) {
    headers["X-Surety-Pin"] = pin;
  }
  return headers;
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "APPROVED":
    case "ACTIVE":
      return "default";
    case "APPROVED_WITH_COLLATERAL":
    case "DOCS_PENDING_SIGNATURE":
    case "IN_REVIEW":
      return "secondary";
    case "DECLINED":
      return "destructive";
    case "RELEASED":
    case "DRAFT":
    default:
      return "outline";
  }
}

function formatCurrency(value: string | null): string {
  if (!value) return "$0";
  const num = parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

export default function SuretyDashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [pin, setPin] = useState<string>("");
  const [pinVerified, setPinVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trusts, setTrusts] = useState<SuretyTrust[]>([]);
  const [cases, setCases] = useState<SuretyCase[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [activeTab, setActiveTab] = useState("cases");

  const [newTrustDialogOpen, setNewTrustDialogOpen] = useState(false);
  const [newTrustForm, setNewTrustForm] = useState({
    name: "",
    trustType: "IRREVOCABLE",
    maxSingleBondLimit: "",
    aggregateBondLimit: "",
    requiresInsuranceAbove: "",
    notes: "",
  });

  const [underwriteDialogOpen, setUnderwriteDialogOpen] = useState(false);
  const [underwriteForm, setUnderwriteForm] = useState({
    bondId: "",
    suretyTrustId: "",
    bondPenalSum: "",
    principalRiskScore: "",
  });
  const [underwriteResult, setUnderwriteResult] = useState<any>(null);

  const [collateralDialogOpen, setCollateralDialogOpen] = useState(false);
  const [selectedCaseForCollateral, setSelectedCaseForCollateral] = useState<SuretyCase | null>(null);
  const [collateralForm, setCollateralForm] = useState({
    collateralType: "CASH",
    amount: "",
    ilocBankName: "",
    ilocReference: "",
  });

  async function verifyPin() {
    if (!pin) {
      toast({
        title: "PIN Required",
        description: "Please enter the surety admin PIN.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/surety/trusts", {
        headers: authHeaders(pin),
      });

      if (res.status === 403) {
        toast({
          title: "Invalid PIN",
          description: "The surety PIN is incorrect.",
          variant: "destructive",
        });
        return;
      }

      if (res.status === 503) {
        toast({
          title: "Surety System Not Configured",
          description: "The SURETY_ADMIN_PIN environment variable is not set.",
          variant: "destructive",
        });
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to verify PIN");
      }

      setPinVerified(true);
      const data = await res.json();
      setTrusts(data.trusts || []);
      await loadCases();
      await loadBonds();

      toast({
        title: "Access Granted",
        description: "Surety system access verified.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to verify PIN.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadTrusts() {
    if (!pinVerified) return;
    try {
      const res = await fetch("/api/admin/surety/trusts", {
        headers: authHeaders(pin),
      });
      if (res.ok) {
        const data = await res.json();
        setTrusts(data.trusts || []);
      }
    } catch (error) {
      console.error("Failed to load trusts:", error);
    }
  }

  async function loadCases() {
    if (!pinVerified && !pin) return;
    try {
      const res = await fetch("/api/admin/surety/cases", {
        headers: authHeaders(pin),
      });
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases || []);
      }
    } catch (error) {
      console.error("Failed to load cases:", error);
    }
  }

  async function loadBonds() {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/bonds", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setBonds(data || []);
      }
    } catch (error) {
      console.error("Failed to load bonds:", error);
    }
  }

  async function createTrust() {
    if (!newTrustForm.name || !newTrustForm.maxSingleBondLimit || !newTrustForm.aggregateBondLimit) {
      toast({
        title: "Missing Fields",
        description: "Name, max single bond limit, and aggregate bond limit are required.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/surety/trusts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(pin),
        },
        body: JSON.stringify(newTrustForm),
      });

      if (!res.ok) {
        throw new Error("Failed to create trust");
      }

      toast({
        title: "Trust Created",
        description: "Surety trust has been created successfully.",
      });

      setNewTrustDialogOpen(false);
      setNewTrustForm({
        name: "",
        trustType: "IRREVOCABLE",
        maxSingleBondLimit: "",
        aggregateBondLimit: "",
        requiresInsuranceAbove: "",
        notes: "",
      });
      await loadTrusts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create surety trust.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function runUnderwriting() {
    if (!underwriteForm.bondId || !underwriteForm.suretyTrustId || !underwriteForm.bondPenalSum || !underwriteForm.principalRiskScore) {
      toast({
        title: "Missing Fields",
        description: "All fields are required for underwriting.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/surety/underwrite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(pin),
        },
        body: JSON.stringify(underwriteForm),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to run underwriting");
      }

      const data = await res.json();
      setUnderwriteResult(data);

      toast({
        title: "Underwriting Complete",
        description: `Decision: ${data.underwritingResult.decision}`,
      });

      await loadCases();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to run underwriting.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function approveCase(caseId: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/surety/cases/${caseId}/approve`, {
        method: "POST",
        headers: authHeaders(pin),
      });

      if (!res.ok) {
        throw new Error("Failed to approve case");
      }

      toast({
        title: "Case Approved",
        description: "Surety case has been approved.",
      });

      await loadCases();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to approve case.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function declineCase(caseId: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/surety/cases/${caseId}/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(pin),
        },
        body: JSON.stringify({ reason: "Manually declined by admin" }),
      });

      if (!res.ok) {
        throw new Error("Failed to decline case");
      }

      toast({
        title: "Case Declined",
        description: "Surety case has been declined.",
      });

      await loadCases();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to decline case.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function recordCollateral() {
    if (!selectedCaseForCollateral || !collateralForm.amount) {
      toast({
        title: "Missing Fields",
        description: "Amount is required.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/surety/cases/${selectedCaseForCollateral.id}/collateral`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(pin),
        },
        body: JSON.stringify(collateralForm),
      });

      if (!res.ok) {
        throw new Error("Failed to record collateral");
      }

      toast({
        title: "Collateral Recorded",
        description: "Collateral has been recorded successfully.",
      });

      setCollateralDialogOpen(false);
      setSelectedCaseForCollateral(null);
      setCollateralForm({
        collateralType: "CASH",
        amount: "",
        ilocBankName: "",
        ilocReference: "",
      });
      await loadCases();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to record collateral.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function activateCase(caseId: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/surety/cases/${caseId}/activate`, {
        method: "POST",
        headers: authHeaders(pin),
      });

      if (!res.ok) {
        throw new Error("Failed to activate case");
      }

      toast({
        title: "Case Activated",
        description: "Surety case is now active.",
      });

      await loadCases();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to activate case.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function releaseCase(caseId: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/surety/cases/${caseId}/release`, {
        method: "POST",
        headers: authHeaders(pin),
      });

      if (!res.ok) {
        throw new Error("Failed to release case");
      }

      toast({
        title: "Case Released",
        description: "Surety case and collateral have been released.",
      });

      await loadCases();
      await loadTrusts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to release case.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  if (!pinVerified) {
    return (
      <div className="container max-w-md mx-auto mt-20">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Lock className="h-12 w-12 text-muted-foreground" />
            </div>
            <CardTitle>Surety System Access</CardTitle>
            <CardDescription>
              Enter the surety admin PIN to access the surety underwriting system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="surety-pin">Admin PIN</Label>
              <Input
                id="surety-pin"
                data-testid="input-surety-pin"
                type="password"
                placeholder="Enter PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") verifyPin();
                }}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              data-testid="button-verify-pin"
              className="w-full"
              onClick={verifyPin}
              disabled={loading}
            >
              {loading ? "Verifying..." : "Access Surety System"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
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
          <h1 className="text-2xl font-semibold">Surety Bond Underwriting</h1>
          <p className="text-muted-foreground">
            Manage surety trusts, underwrite judgment bonds, and track collateral.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="button-refresh-surety"
            variant="outline"
            size="icon"
            onClick={() => {
              loadTrusts();
              loadCases();
            }}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={underwriteDialogOpen} onOpenChange={setUnderwriteDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-underwriting">
                <Plus className="h-4 w-4 mr-2" />
                New Underwriting
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Run Surety Underwriting</DialogTitle>
                <DialogDescription>
                  Evaluate a bond for surety coverage with risk-based collateral calculation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Bond</Label>
                  <Select
                    value={underwriteForm.bondId}
                    onValueChange={(v) => setUnderwriteForm({ ...underwriteForm, bondId: v })}
                  >
                    <SelectTrigger data-testid="select-bond">
                      <SelectValue placeholder="Select a bond" />
                    </SelectTrigger>
                    <SelectContent>
                      {bonds.map((bond) => (
                        <SelectItem key={bond.id} value={String(bond.id)}>
                          {bond.name} ({formatCurrency(bond.faceValue)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Surety Trust</Label>
                  <Select
                    value={underwriteForm.suretyTrustId}
                    onValueChange={(v) => setUnderwriteForm({ ...underwriteForm, suretyTrustId: v })}
                  >
                    <SelectTrigger data-testid="select-trust">
                      <SelectValue placeholder="Select a trust" />
                    </SelectTrigger>
                    <SelectContent>
                      {trusts.map((trust) => (
                        <SelectItem key={trust.id} value={String(trust.id)}>
                          {trust.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bondPenalSum">Bond Penal Sum ($)</Label>
                  <Input
                    id="bondPenalSum"
                    data-testid="input-penal-sum"
                    type="number"
                    placeholder="Enter bond amount"
                    value={underwriteForm.bondPenalSum}
                    onChange={(e) => setUnderwriteForm({ ...underwriteForm, bondPenalSum: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="principalRiskScore">Principal Risk Score (0-100)</Label>
                  <Input
                    id="principalRiskScore"
                    data-testid="input-risk-score"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Enter risk score"
                    value={underwriteForm.principalRiskScore}
                    onChange={(e) => setUnderwriteForm({ ...underwriteForm, principalRiskScore: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower score = lower risk. {"<30"} low risk, 30-50 moderate, {">50"} high risk.
                  </p>
                </div>

                {underwriteResult && (
                  <Card className="mt-4">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Underwriting Result</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Decision:</span>
                        <Badge variant={underwriteResult.underwritingResult.decision === "DECLINED" ? "destructive" : "default"}>
                          {underwriteResult.underwritingResult.decision}
                        </Badge>
                      </div>
                      {underwriteResult.underwritingResult.collateralRequiredAmount > 0 && (
                        <div>
                          <span className="font-medium">Collateral Required:</span>{" "}
                          {formatCurrency(String(underwriteResult.underwritingResult.collateralRequiredAmount))}
                          {" "}({underwriteResult.underwritingResult.collateralPercentage}%)
                        </div>
                      )}
                      <div className="text-sm text-muted-foreground">
                        {underwriteResult.underwritingResult.reasoning}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
              <DialogFooter>
                <Button
                  data-testid="button-run-underwriting"
                  onClick={runUnderwriting}
                  disabled={loading}
                >
                  {loading ? "Processing..." : "Run Underwriting"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Active Trusts</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{trusts.filter(t => t.canActAsSurety).length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Open Cases</CardTitle>
            <FileCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cases.filter(c => !["DECLINED", "RELEASED"].includes(c.status)).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Total Exposure</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(
                String(trusts.reduce((sum, t) => sum + parseFloat(t.currentExposure || "0"), 0))
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cases.filter(c => c.status === "IN_REVIEW").length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="cases" data-testid="tab-cases">Cases</TabsTrigger>
          <TabsTrigger value="trusts" data-testid="tab-trusts">Trusts</TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Surety Cases</CardTitle>
              <CardDescription>
                All surety underwriting cases and their current status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {cases.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No surety cases yet. Create one by running underwriting on a bond.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case ID</TableHead>
                      <TableHead>Bond ID</TableHead>
                      <TableHead>Penal Sum</TableHead>
                      <TableHead>Collateral Req.</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((suretyCase) => (
                      <TableRow key={suretyCase.id} data-testid={`row-case-${suretyCase.id}`}>
                        <TableCell className="font-mono">{suretyCase.id}</TableCell>
                        <TableCell>{suretyCase.bondId}</TableCell>
                        <TableCell>{formatCurrency(suretyCase.bondPenalSum)}</TableCell>
                        <TableCell>{formatCurrency(suretyCase.collateralRequiredAmount)}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(suretyCase.status)}>
                            {suretyCase.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {suretyCase.status === "IN_REVIEW" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => approveCase(suretyCase.id)}
                                  disabled={loading}
                                  data-testid={`button-approve-${suretyCase.id}`}
                                >
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => declineCase(suretyCase.id)}
                                  disabled={loading}
                                  data-testid={`button-decline-${suretyCase.id}`}
                                >
                                  <XCircle className="h-4 w-4 text-red-600" />
                                </Button>
                              </>
                            )}
                            {suretyCase.status === "APPROVED_WITH_COLLATERAL" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedCaseForCollateral(suretyCase);
                                  setCollateralDialogOpen(true);
                                }}
                                disabled={loading}
                                data-testid={`button-collateral-${suretyCase.id}`}
                              >
                                Record Collateral
                              </Button>
                            )}
                            {suretyCase.status === "DOCS_PENDING_SIGNATURE" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => activateCase(suretyCase.id)}
                                disabled={loading}
                                data-testid={`button-activate-${suretyCase.id}`}
                              >
                                Activate
                              </Button>
                            )}
                            {suretyCase.status === "ACTIVE" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => releaseCase(suretyCase.id)}
                                disabled={loading}
                                data-testid={`button-release-${suretyCase.id}`}
                              >
                                Release
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trusts" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Surety Trusts</CardTitle>
                <CardDescription>
                  Organizations authorized to act as surety for judgment bonds.
                </CardDescription>
              </div>
              <Dialog open={newTrustDialogOpen} onOpenChange={setNewTrustDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-new-trust">
                    <Plus className="h-4 w-4 mr-2" />
                    New Trust
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Surety Trust</DialogTitle>
                    <DialogDescription>
                      Add a new surety trust to the system.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="trust-name">Trust Name</Label>
                      <Input
                        id="trust-name"
                        data-testid="input-trust-name"
                        placeholder="Enter trust name"
                        value={newTrustForm.name}
                        onChange={(e) => setNewTrustForm({ ...newTrustForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Trust Type</Label>
                      <Select
                        value={newTrustForm.trustType}
                        onValueChange={(v) => setNewTrustForm({ ...newTrustForm, trustType: v })}
                      >
                        <SelectTrigger data-testid="select-trust-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="IRREVOCABLE">Irrevocable</SelectItem>
                          <SelectItem value="REVOCABLE">Revocable</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max-single">Max Single Bond Limit ($)</Label>
                      <Input
                        id="max-single"
                        data-testid="input-max-single"
                        type="number"
                        placeholder="e.g., 500000"
                        value={newTrustForm.maxSingleBondLimit}
                        onChange={(e) => setNewTrustForm({ ...newTrustForm, maxSingleBondLimit: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="aggregate">Aggregate Bond Limit ($)</Label>
                      <Input
                        id="aggregate"
                        data-testid="input-aggregate"
                        type="number"
                        placeholder="e.g., 5000000"
                        value={newTrustForm.aggregateBondLimit}
                        onChange={(e) => setNewTrustForm({ ...newTrustForm, aggregateBondLimit: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="insurance-threshold">Insurance Required Above ($)</Label>
                      <Input
                        id="insurance-threshold"
                        data-testid="input-insurance"
                        type="number"
                        placeholder="e.g., 100000"
                        value={newTrustForm.requiresInsuranceAbove}
                        onChange={(e) => setNewTrustForm({ ...newTrustForm, requiresInsuranceAbove: e.target.value })}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      data-testid="button-create-trust"
                      onClick={createTrust}
                      disabled={loading}
                    >
                      {loading ? "Creating..." : "Create Trust"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {trusts.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No surety trusts yet. Create one to start underwriting.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Max Single</TableHead>
                      <TableHead>Aggregate</TableHead>
                      <TableHead>Current Exposure</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trusts.map((trust) => (
                      <TableRow key={trust.id} data-testid={`row-trust-${trust.id}`}>
                        <TableCell className="font-medium">{trust.name}</TableCell>
                        <TableCell>{trust.trustType}</TableCell>
                        <TableCell>{formatCurrency(trust.maxSingleBondLimit)}</TableCell>
                        <TableCell>{formatCurrency(trust.aggregateBondLimit)}</TableCell>
                        <TableCell>{formatCurrency(trust.currentExposure)}</TableCell>
                        <TableCell>
                          <Badge variant={trust.canActAsSurety ? "default" : "secondary"}>
                            {trust.canActAsSurety ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={collateralDialogOpen} onOpenChange={setCollateralDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Collateral</DialogTitle>
            <DialogDescription>
              Record collateral posted for case #{selectedCaseForCollateral?.id}.
              Required: {selectedCaseForCollateral ? formatCurrency(selectedCaseForCollateral.collateralRequiredAmount) : "$0"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Collateral Type</Label>
              <Select
                value={collateralForm.collateralType}
                onValueChange={(v) => setCollateralForm({ ...collateralForm, collateralType: v })}
              >
                <SelectTrigger data-testid="select-collateral-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="ILOC">Irrevocable Letter of Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="collateral-amount">Amount ($)</Label>
              <Input
                id="collateral-amount"
                data-testid="input-collateral-amount"
                type="number"
                placeholder="Enter amount"
                value={collateralForm.amount}
                onChange={(e) => setCollateralForm({ ...collateralForm, amount: e.target.value })}
              />
            </div>
            {collateralForm.collateralType === "ILOC" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="iloc-bank">Issuing Bank</Label>
                  <Input
                    id="iloc-bank"
                    data-testid="input-iloc-bank"
                    placeholder="Bank name"
                    value={collateralForm.ilocBankName}
                    onChange={(e) => setCollateralForm({ ...collateralForm, ilocBankName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="iloc-ref">ILOC Reference</Label>
                  <Input
                    id="iloc-ref"
                    data-testid="input-iloc-ref"
                    placeholder="Reference number"
                    value={collateralForm.ilocReference}
                    onChange={(e) => setCollateralForm({ ...collateralForm, ilocReference: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              data-testid="button-record-collateral"
              onClick={recordCollateral}
              disabled={loading}
            >
              {loading ? "Recording..." : "Record Collateral"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
