// client/src/pages/bonds.tsx
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowLeft, ChevronLeft } from "lucide-react";

type Bond = {
  id: number;
  name: string;
  cusip: string | null;
  isin: string | null;
  ticker: string | null;
  faceValue: string | null;
  currency: string | null;
  couponRate: string | null;
  couponType: string | null;
  maturityDate: string | null;
  issueDate: string | null;
  jurisdiction: string | null;
  governingLaw: string | null;
  status: string | null;
  bondScore: number | null;
  riskTier: "low" | "moderate" | "high" | null;
};

type BondDocument = {
  id: number;
  bondId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "template" | "supporting";
  description: string | null;
  aiSummary: string | null;
  tags: string[] | null;
  createdAt: string;
};

type BondExtractionResult = {
  issuerName: string | null;
  bondName: string | null;
  cusip: string | null;
  isin: string | null;
  ticker: string | null;
  faceValue: number | null;
  currency: string | null;
  couponRate: number | null;
  couponType: string | null;
  maturityDate: string | null;
  issueDate: string | null;
  jurisdiction: string | null;
  governingLaw: string | null;
  bondScore: number;
  riskTier: "low" | "moderate" | "high";
  warnings: string[];
};

type ProcessStep = {
  step: string;
  label: string;
  docTypes: string[];
};

type GeneratedDoc = {
  id: string;
  docType: string;
  label: string;
  storagePath: string;
  generatedAt: string;
};

type BondProcessDoc = {
  id: number;
  bondId: number;
  processStep: string;
  docType: string;
  filename: string;
  storagePath: string;
  status: string;
  createdAt: string;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  BOND_TERM_SHEET: "Bond Term Sheet",
  BOND_INSTRUMENT: "Bond Instrument",
  PERFECTION_CERT: "Perfection Certificate",
  GIA: "General Indemnity Agreement",
  COLLATERAL_AGREEMENT: "Collateral Agreement",
  SURETY_TRUST_RESOLUTION: "Surety Trust Resolution",
  UNDERWRITING_REPORT: "Underwriting Report",
  EXCHANGE_OFFERING_SHEET: "Exchange Offering Sheet",
  INVESTOR_SUBSCRIPTION: "Investor Subscription Agreement",
  TRADE_CONFIRMATION: "Trade Confirmation",
  TRUST_BOARD_MINUTES: "Trust Board Minutes",
  TRUST_ALLOCATION_RESOLUTION: "Trust Allocation Resolution",
};

const STEP_LABELS: Record<string, string> = {
  JUDGMENT_TO_BOND: "Judgment to Bond",
  PERFECTION: "Perfection",
  SURETY_UNDERWRITING: "Surety Underwriting",
  SURETY_ACTIVATION: "Surety Activation",
  EXCHANGE_LISTING: "Exchange Listing",
  EXCHANGE_SALE: "Exchange Sale",
  TRUST_ALLOCATION: "Trust Allocation",
};

function getRiskTierClasses(tier: Bond["riskTier"]): string {
  if (!tier) return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200";

  switch (tier) {
    case "low":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
    case "moderate":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    case "high":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200";
  }
}

function formatBondScore(score: number | null): string {
  if (score == null) return "Not scored";
  return `${score}/100`;
}

export default function BondsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [bonds, setBonds] = useState<Bond[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBond, setSelectedBond] = useState<Bond | null>(null);
  const [docs, setDocs] = useState<BondDocument[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftInstructions, setDraftInstructions] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [bondScorePreview, setBondScorePreview] = useState<number | null>(null);
  const [bondRiskTierPreview, setBondRiskTierPreview] = useState<string | null>(null);
  const [bondExtractionWarnings, setBondExtractionWarnings] = useState<string[]>([]);

  const [form, setForm] = useState({
    name: "",
    cusip: "",
    isin: "",
    ticker: "",
    faceValue: "",
    currency: "USD",
    couponRate: "",
    couponType: "fixed",
    maturityDate: "",
    issueDate: "",
    jurisdiction: "",
    governingLaw: "",
  });

  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);
  const [selectedStep, setSelectedStep] = useState("");
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [bondProcessDocs, setBondProcessDocs] = useState<BondProcessDoc[]>([]);

  function authHeaders(): HeadersInit {
    const token = localStorage.getItem("auth_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadBonds() {
    setLoading(true);
    try {
      const res = await fetch("/api/bonds", {
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
      });
      if (!res.ok) {
        throw new Error("Failed to load bonds");
      }
      const data = (await res.json()) as Bond[];
      setBonds(data);
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error loading bonds",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadDocuments(bondId: number) {
    try {
      const res = await fetch(`/api/bonds/${bondId}`, {
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
      });
      if (!res.ok) {
        throw new Error("Failed to load bond details");
      }
      const data = (await res.json()) as { bond: Bond; documents: BondDocument[] };
      setSelectedBond(data.bond);
      setDocs(data.documents);
      void loadBondProcessDocs(bondId);
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error loading bond",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (token) {
      void loadBonds();
      void loadProcessSteps();
    }
  }, []);

  async function loadProcessSteps() {
    try {
      const res = await fetch("/api/admin/docs/steps", {
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
      });
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { steps: ProcessStep[] };
      setProcessSteps(data.steps || []);
    } catch (error) {
      console.error("Failed to load process steps:", error);
    }
  }

  async function loadBondProcessDocs(bondId: number) {
    try {
      const res = await fetch(`/api/admin/bonds/${bondId}/documents`, {
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
      });
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { documents: BondProcessDoc[] };
      setBondProcessDocs(data.documents || []);
    } catch (error) {
      console.error("Failed to load bond process docs:", error);
    }
  }

  async function handleGenerateDocuments() {
    if (!selectedBond || !selectedStep) return;
    setGeneratingDocs(true);
    try {
      const res = await fetch(`/api/admin/bonds/${selectedBond.id}/generate-docs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ step: selectedStep }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate documents");
      }
      const data = (await res.json()) as { docs: GeneratedDoc[]; message: string };
      toast({
        title: "Documents Generated",
        description: data.message,
      });
      void loadBondProcessDocs(selectedBond.id);
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error generating documents",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setGeneratingDocs(false);
    }
  }

  function handleDownloadDoc(bondId: number, docId: number, filename: string) {
    const token = localStorage.getItem("auth_token");
    const url = `/api/admin/bonds/${bondId}/documents/${docId}`;
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      })
      .catch((err) => {
        console.error("Download failed:", err);
        toast({
          title: "Download failed",
          description: "Could not download document",
          variant: "destructive",
        });
      });
  }

  function handleFormChange<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleExtractFromDocument(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtracting(true);
    setBondExtractionWarnings([]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/bonds/extract-from-document", {
        method: "POST",
        headers: {
          ...authHeaders(),
        },
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to extract bond data");
      }

      const data = (await res.json()) as BondExtractionResult;

      // Auto-fill the bond creation form with extracted fields
      setForm((prev) => ({
        ...prev,
        name: data.bondName ?? prev.name,
        cusip: data.cusip ?? prev.cusip,
        isin: data.isin ?? prev.isin,
        ticker: data.ticker ?? prev.ticker,
        faceValue:
          data.faceValue != null ? String(data.faceValue) : prev.faceValue,
        currency: data.currency ?? prev.currency,
        couponRate:
          data.couponRate != null ? String(data.couponRate) : prev.couponRate,
        couponType: data.couponType ?? prev.couponType,
        maturityDate: data.maturityDate ?? prev.maturityDate,
        issueDate: data.issueDate ?? prev.issueDate,
        jurisdiction: data.jurisdiction ?? prev.jurisdiction,
        governingLaw: data.governingLaw ?? prev.governingLaw,
      }));

      setBondScorePreview(data.bondScore);
      setBondRiskTierPreview(data.riskTier);
      setBondExtractionWarnings(data.warnings ?? []);

      toast({
        title: "Bond data extracted",
        description:
          "We auto-filled as many bond fields as we could from the uploaded document.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Bond extraction failed",
        description:
          error instanceof Error
            ? error.message
            : "Unable to extract bond data from this file.",
        variant: "destructive",
      });
    } finally {
      setExtracting(false);
      // allow re-selecting the same file if needed
      e.target.value = "";
    }
  }

  async function handleCreateBond(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/bonds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          ...form,
          faceValue: form.faceValue ? Number(form.faceValue) : null,
          couponRate: form.couponRate ? Number(form.couponRate) : null,
          bondScore: bondScorePreview,
          riskTier: bondRiskTierPreview,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to create bond");
      }
      const created = (await res.json()) as Bond;
      setBonds((prev) => [created, ...prev]);
      setForm({
        name: "",
        cusip: "",
        isin: "",
        ticker: "",
        faceValue: "",
        currency: "USD",
        couponRate: "",
        couponType: "fixed",
        maturityDate: "",
        issueDate: "",
        jurisdiction: "",
        governingLaw: "",
      });
      
      // Clear AI extraction preview to prevent stale data in next bond
      setBondScorePreview(null);
      setBondRiskTierPreview(null);
      setBondExtractionWarnings([]);
      
      toast({
        title: "Bond created",
        description: "Your bond instrument was created successfully.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error creating bond",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, kind: "template" | "supporting") {
    if (!selectedBond) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("kind", kind);

    try {
      const res = await fetch(`/api/bonds/${selectedBond.id}/documents`, {
        method: "POST",
        headers: {
          ...authHeaders(),
        },
        body: formData,
      });
      if (!res.ok) {
        throw new Error("Failed to upload document");
      }
      const created = (await res.json()) as BondDocument;
      setDocs((prev) => [created, ...prev]);
      toast({
        title: "Document uploaded",
        description: "The document was attached to this bond.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error uploading document",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      // reset file input
      e.target.value = "";
    }
  }

  async function handleGenerateDraft() {
    if (!selectedBond) return;
    setDraftLoading(true);
    try {
      const res = await fetch(`/api/bonds/${selectedBond.id}/ai-draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          purpose: draftInstructions || undefined,
          style: "term_sheet",
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to generate draft");
      }
      const data = (await res.json()) as { draft: string };
      setDraft(data.draft);
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error generating draft",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleEditDraft() {
    if (!selectedBond || !draft.trim()) return;
    setDraftLoading(true);
    try {
      const res = await fetch(`/api/bonds/${selectedBond.id}/ai-edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          existingDraft: draft,
          instructions: draftInstructions || "Improve clarity and structure.",
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to edit draft");
      }
      const data = (await res.json()) as { draft: string };
      setDraft(data.draft);
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error editing draft",
        description: error.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setDraftLoading(false);
    }
  }

  return (
    <div className="space-y-6">
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
        <h1 className="text-2xl font-bold tracking-tight">Bonds</h1>
        <p className="text-muted-foreground">
          Create and manage real bond instruments, attach documents, and generate AI-assisted drafts.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
        <Card>
          <CardHeader>
            <CardTitle>New Bond</CardTitle>
            <CardDescription>
              Enter real-world information only. Do not use placeholders or mock data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateBond}>
              <div className="space-y-2">
                <Label htmlFor="bond-extract-file">Upload bond PDF/DOCX to auto-fill</Label>
                <Input
                  id="bond-extract-file"
                  data-testid="input-bond-extract-file"
                  type="file"
                  accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleExtractFromDocument}
                  disabled={extracting}
                />
                {extracting && (
                  <p className="text-xs text-muted-foreground">
                    Analyzing bond document…
                  </p>
                )}
                {bondScorePreview !== null && (
                  <p className="text-xs text-muted-foreground" data-testid="text-bond-score-preview">
                    AI bond score:{" "}
                    <span className="font-semibold">{bondScorePreview}/100</span>{" "}
                    {bondRiskTierPreview && <>({bondRiskTierPreview} risk)</>}
                  </p>
                )}
                {bondExtractionWarnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-600" data-testid="list-bond-warnings">
                    {bondExtractionWarnings.map((w, idx) => (
                      <li key={idx}>• {w}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bond-name">Bond name</Label>
                <Input
                  id="bond-name"
                  data-testid="input-bond-name"
                  required
                  value={form.name}
                  onChange={(e) => handleFormChange("name", e.target.value)}
                  placeholder="Example: 2029 Senior Secured Notes"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cusip">CUSIP</Label>
                  <Input
                    id="cusip"
                    value={form.cusip}
                    onChange={(e) => handleFormChange("cusip", e.target.value)}
                    placeholder="e.g. 123456AB9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="isin">ISIN</Label>
                  <Input
                    id="isin"
                    value={form.isin}
                    onChange={(e) => handleFormChange("isin", e.target.value)}
                    placeholder="e.g. US123456AB90"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ticker">Ticker (optional)</Label>
                  <Input
                    id="ticker"
                    value={form.ticker}
                    onChange={(e) => handleFormChange("ticker", e.target.value)}
                    placeholder="e.g. XYZ"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    value={form.currency}
                    onChange={(e) => handleFormChange("currency", e.target.value)}
                    placeholder="USD"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="faceValue">Face value</Label>
                  <Input
                    id="faceValue"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.faceValue}
                    onChange={(e) => handleFormChange("faceValue", e.target.value)}
                    placeholder="1000000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="couponRate">Coupon (%)</Label>
                  <Input
                    id="couponRate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.couponRate}
                    onChange={(e) => handleFormChange("couponRate", e.target.value)}
                    placeholder="7.50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="couponType">Coupon type</Label>
                  <Input
                    id="couponType"
                    value={form.couponType}
                    onChange={(e) => handleFormChange("couponType", e.target.value)}
                    placeholder="fixed / floating"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="issueDate">Issue date</Label>
                  <Input
                    id="issueDate"
                    type="date"
                    value={form.issueDate}
                    onChange={(e) => handleFormChange("issueDate", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maturityDate">Maturity date</Label>
                  <Input
                    id="maturityDate"
                    type="date"
                    value={form.maturityDate}
                    onChange={(e) => handleFormChange("maturityDate", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jurisdiction">Jurisdiction</Label>
                  <Input
                    id="jurisdiction"
                    value={form.jurisdiction}
                    onChange={(e) => handleFormChange("jurisdiction", e.target.value)}
                    placeholder="e.g. State of New York, USA"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="governingLaw">Governing law</Label>
                  <Input
                    id="governingLaw"
                    value={form.governingLaw}
                    onChange={(e) => handleFormChange("governingLaw", e.target.value)}
                    placeholder="e.g. New York law"
                  />
                </div>
              </div>

              <Button type="submit" className="mt-4" disabled={creating}>
                {creating ? "Creating…" : "Create Bond"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="min-h-[420px]">
          <CardHeader>
            <CardTitle>Your Bonds</CardTitle>
            <CardDescription>Select a bond to view documents and AI tools.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading bonds…</p>
            ) : bonds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bonds yet. Create your first bond using the form on the left.
              </p>
            ) : (
              <div className="space-y-2">
                {bonds.map((bond) => (
                  <button
                    key={bond.id}
                    type="button"
                    onClick={() => void loadDocuments(bond.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md border text-sm hover:bg-accent",
                      selectedBond?.id === bond.id && "border-primary bg-accent"
                    )}
                    data-testid={`bond-card-${bond.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{bond.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {bond.cusip || bond.isin || "No CUSIP/ISIN set"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {bond.bondScore != null ? (
                          <Badge
                            className={cn(
                              "text-xs font-medium px-2 py-0.5 rounded-full",
                              getRiskTierClasses(bond.riskTier)
                            )}
                            data-testid={`bond-score-badge-${bond.id}`}
                          >
                            {formatBondScore(bond.bondScore)}
                            {bond.riskTier && (
                              <span className="ml-1 capitalize">
                                ({bond.riskTier})
                              </span>
                            )}
                          </Badge>
                        ) : (
                          <Badge 
                            className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs"
                            data-testid={`bond-score-badge-${bond.id}`}
                          >
                            Not scored
                          </Badge>
                        )}
                        {bond.status && <Badge variant="outline">{bond.status}</Badge>}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Face value:{" "}
                      {bond.faceValue
                        ? `$${Number(bond.faceValue).toLocaleString()}`
                        : "—"}
                      {" · "}
                      Coupon:{" "}
                      {bond.couponRate
                        ? `${Number(bond.couponRate).toFixed(2)}%`
                        : "—"}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {selectedBond && (
              <div className="space-y-4 border-t pt-4 mt-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{selectedBond.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedBond.cusip || selectedBond.isin || "No CUSIP/ISIN set"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">Attach documents</p>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="upload-template"
                        className="cursor-pointer text-xs underline"
                      >
                        Upload template
                      </Label>
                      <input
                        id="upload-template"
                        type="file"
                        className="hidden"
                        onChange={(e) => void handleFileUpload(e, "template")}
                      />
                      <Label
                        htmlFor="upload-supporting"
                        className="cursor-pointer text-xs underline"
                      >
                        Upload supporting
                      </Label>
                      <input
                        id="upload-supporting"
                        type="file"
                        className="hidden"
                        onChange={(e) => void handleFileUpload(e, "supporting")}
                      />
                    </div>
                  </div>

                  {docs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No documents attached yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {docs.map((doc) => (
                        <div
                          key={doc.id}
                          className="border rounded-md px-3 py-2 flex flex-col gap-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium">{doc.filename}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {doc.kind === "template" ? "Template" : "Supporting"} ·{" "}
                                {(doc.sizeBytes / 1024).toFixed(1)} KB
                              </p>
                            </div>
                          </div>
                          {doc.aiSummary && (
                            <p className="text-[11px] text-muted-foreground line-clamp-3">
                              {doc.aiSummary}
                            </p>
                          )}
                          {doc.tags && doc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {doc.tags.map((tag) => (
                                <Badge key={tag} variant="outline" className="text-[10px]">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="draftInstructions" className="text-xs">
                    Draft instructions / focus
                  </Label>
                  <Textarea
                    id="draftInstructions"
                    rows={3}
                    value={draftInstructions}
                    onChange={(e) => setDraftInstructions(e.target.value)}
                    placeholder="Example: Term sheet style summary compliant with U.S. law; emphasize coupon, maturity, and security. This is for counsel to review, not final."
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleGenerateDraft} disabled={draftLoading}>
                      {draftLoading ? "Working…" : "Generate draft"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleEditDraft}
                      disabled={draftLoading || !draft.trim()}
                    >
                      Refine draft
                    </Button>
                  </div>
                  <Textarea
                    className="mt-2 font-mono text-xs"
                    rows={12}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="AI-generated draft will appear here. Always have qualified counsel review before use."
                  />
                </div>

                <div className="space-y-3 border-t pt-3">
                  <div>
                    <h4 className="text-xs font-semibold">Document Engine (Admin Only)</h4>
                    <p className="text-[10px] text-muted-foreground">
                      Generate legal/financial PDFs for each step in the bond lifecycle.
                    </p>
                  </div>

                  {processSteps.length > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="processStep" className="text-xs">Process Step</Label>
                      <select
                        id="processStep"
                        data-testid="select-process-step"
                        value={selectedStep}
                        onChange={(e) => setSelectedStep(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select a process step…</option>
                        {processSteps.map((ps) => (
                          <option key={ps.step} value={ps.step}>
                            {STEP_LABELS[ps.step] || ps.step} ({ps.docTypes.length} docs)
                          </option>
                        ))}
                      </select>

                      {selectedStep && (
                        <div className="text-[10px] text-muted-foreground space-y-1">
                          <p className="font-medium">Documents to generate:</p>
                          <ul className="list-disc list-inside">
                            {processSteps
                              .find((ps) => ps.step === selectedStep)
                              ?.docTypes.map((dt) => (
                                <li key={dt}>{DOC_TYPE_LABELS[dt] || dt}</li>
                              ))}
                          </ul>
                        </div>
                      )}

                      <Button
                        size="sm"
                        onClick={handleGenerateDocuments}
                        disabled={generatingDocs || !selectedStep}
                        data-testid="button-generate-docs"
                      >
                        {generatingDocs ? "Generating…" : "Generate Documents"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      Loading process steps… (Admin access required)
                    </p>
                  )}

                  {bondProcessDocs.length > 0 && (
                    <div className="space-y-2 mt-3">
                      <p className="text-xs font-medium">Generated Documents</p>
                      <div className="space-y-1">
                        {bondProcessDocs.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between gap-2 border rounded-md px-2 py-1.5"
                            data-testid={`doc-item-${doc.id}`}
                          >
                            <div>
                              <p className="text-xs font-medium">
                                {DOC_TYPE_LABELS[doc.docType] || doc.docType}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {STEP_LABELS[doc.processStep] || doc.processStep} ·{" "}
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  {doc.status}
                                </Badge>
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadDoc(doc.bondId, doc.id, doc.filename)}
                              data-testid={`button-download-doc-${doc.id}`}
                            >
                              Download
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
