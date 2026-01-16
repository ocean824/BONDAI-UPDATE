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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Package, Plus, FileText, DollarSign, Trash2, Download, ChevronLeft } from "lucide-react";
import type { Bundle, Judgment, BundleWithJudgments } from "@shared/schema";

export default function BundlesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [addJudgmentDialogOpen, setAddJudgmentDialogOpen] = useState(false);
  const [newBundleName, setNewBundleName] = useState("");
  const [newBundleDesc, setNewBundleDesc] = useState("");
  const [selectedJudgmentId, setSelectedJudgmentId] = useState("");
  const [selectedTranche, setSelectedTranche] = useState("senior");

  const { data: bundles, isLoading: bundlesLoading } = useQuery<Bundle[]>({
    queryKey: ["/api/bundles"],
  });

  const { data: bundleDetail } = useQuery<BundleWithJudgments>({
    queryKey: ["/api/bundles", selectedBundle?.id],
    enabled: !!selectedBundle?.id,
  });

  const { data: availableJudgments } = useQuery<Judgment[]>({
    queryKey: ["/api/judgments"],
  });

  const createBundleMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", "/api/bundles", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bundles"] });
      setCreateDialogOpen(false);
      setNewBundleName("");
      setNewBundleDesc("");
      toast({
        title: "Bundle created",
        description: "New bundle has been created successfully",
      });
    },
  });

  const addJudgmentMutation = useMutation({
    mutationFn: async (data: { bundleId: number; judgmentId: number; tranche: string }) => {
      return apiRequest("POST", `/api/bundles/${data.bundleId}/judgments`, {
        judgmentId: data.judgmentId,
        tranche: data.tranche,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bundles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bundles", selectedBundle?.id] });
      setAddJudgmentDialogOpen(false);
      toast({
        title: "Judgment added",
        description: "Judgment added to bundle successfully",
      });
    },
  });

  const removeJudgmentMutation = useMutation({
    mutationFn: async (data: { bundleId: number; judgmentId: number }) => {
      return apiRequest("DELETE", `/api/bundles/${data.bundleId}/judgments/${data.judgmentId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bundles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bundles", selectedBundle?.id] });
      toast({
        title: "Judgment removed",
        description: "Judgment removed from bundle",
      });
    },
  });

  const handleCreateBundle = () => {
    if (newBundleName.trim()) {
      createBundleMutation.mutate({
        name: newBundleName,
        description: newBundleDesc,
      });
    }
  };

  const handleAddJudgment = () => {
    if (selectedBundle && selectedJudgmentId) {
      addJudgmentMutation.mutate({
        bundleId: selectedBundle.id,
        judgmentId: parseInt(selectedJudgmentId),
        tranche: selectedTranche,
      });
    }
  };

  const handleRemoveJudgment = (judgmentId: number) => {
    if (selectedBundle) {
      removeJudgmentMutation.mutate({
        bundleId: selectedBundle.id,
        judgmentId,
      });
    }
  };

  const getTrancheTotals = (tranche: string) => {
    if (!bundleDetail?.judgments) return { count: 0, faceValue: 0, recommendedPurchase: 0 };
    
    const trancheJudgments = bundleDetail.judgments.filter((bj) => bj.tranche === tranche);
    const count = trancheJudgments.length;
    const faceValue = trancheJudgments.reduce(
      (sum, bj) => sum + parseFloat(bj.judgment.judgmentAmount || "0"),
      0
    );
    
    return { count, faceValue, recommendedPurchase: faceValue * 0.7 };
  };

  const seniorTotals = getTrancheTotals("senior");
  const mezzTotals = getTrancheTotals("mezz");
  const equityTotals = getTrancheTotals("equity");

  const overallTotals = {
    count: seniorTotals.count + mezzTotals.count + equityTotals.count,
    faceValue: seniorTotals.faceValue + mezzTotals.faceValue + equityTotals.faceValue,
    recommendedPurchase: seniorTotals.recommendedPurchase + mezzTotals.recommendedPurchase + equityTotals.recommendedPurchase,
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
          <h1 className="text-3xl font-semibold mb-2">Bundle Builder</h1>
          <p className="text-muted-foreground">
            Create and manage investment bundles with tranche allocation
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-bundle">
              <Plus className="w-4 h-4 mr-2" />
              Create Bundle
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Bundle</DialogTitle>
              <DialogDescription>
                Create a new investment bundle for judgment allocation
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="bundleName">Bundle Name</Label>
                <Input
                  id="bundleName"
                  value={newBundleName}
                  onChange={(e) => setNewBundleName(e.target.value)}
                  placeholder="Q1 2025 Investment Bundle"
                  data-testid="input-bundle-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bundleDesc">Description (Optional)</Label>
                <Textarea
                  id="bundleDesc"
                  value={newBundleDesc}
                  onChange={(e) => setNewBundleDesc(e.target.value)}
                  placeholder="First quarter investment portfolio..."
                  rows={3}
                  data-testid="input-bundle-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreateBundle}
                disabled={createBundleMutation.isPending || !newBundleName.trim()}
                data-testid="button-confirm-create"
              >
                {createBundleMutation.isPending ? "Creating..." : "Create Bundle"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Bundles ({bundles?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bundlesLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))
              ) : bundles && bundles.length > 0 ? (
                bundles.map((bundle) => (
                  <Card
                    key={bundle.id}
                    className={`cursor-pointer hover-elevate transition-all ${
                      selectedBundle?.id === bundle.id ? "border-primary" : ""
                    }`}
                    onClick={() => setSelectedBundle(bundle)}
                    data-testid={`bundle-card-${bundle.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-medium truncate" data-testid={`bundle-name-${bundle.id}`}>
                          {bundle.name}
                        </p>
                        <Badge variant="secondary" className="text-xs">
                          {bundle.status}
                        </Badge>
                      </div>
                      {bundle.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {bundle.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Package className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {bundleDetail?.judgments?.length || 0} judgments
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-8">
                  <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No bundles yet</p>
                  <p className="text-xs text-muted-foreground">Create your first bundle</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          {selectedBundle ? (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{selectedBundle.name}</CardTitle>
                      <CardDescription>{selectedBundle.description || "No description"}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem("auth_token");
                            const response = await fetch(`/api/teaser/${selectedBundle.id}`, {
                              headers: {
                                "Authorization": `Bearer ${token}`,
                              },
                            });

                            if (!response.ok) {
                              throw new Error("Failed to download PDF");
                            }

                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `bundle-${selectedBundle.id}-teaser.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);

                            toast({
                              title: "PDF Downloaded",
                              description: "Investor teaser PDF has been downloaded successfully",
                            });
                          } catch (error) {
                            toast({
                              title: "Download Failed",
                              description: "Failed to download teaser PDF",
                              variant: "destructive",
                            });
                          }
                        }}
                        data-testid="button-download-teaser"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download Teaser
                      </Button>
                      <Dialog open={addJudgmentDialogOpen} onOpenChange={setAddJudgmentDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" data-testid="button-add-judgment">
                            <Plus className="w-4 h-4 mr-2" />
                            Add Judgment
                          </Button>
                        </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add Judgment to Bundle</DialogTitle>
                          <DialogDescription>
                            Select a judgment and assign it to a tranche
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Judgment</Label>
                            <Select value={selectedJudgmentId} onValueChange={setSelectedJudgmentId}>
                              <SelectTrigger data-testid="select-judgment">
                                <SelectValue placeholder="Select a judgment" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableJudgments?.map((judgment) => (
                                  <SelectItem key={judgment.id} value={judgment.id.toString()}>
                                    {judgment.debtorName} - ${parseFloat(judgment.judgmentAmount || "0").toLocaleString()}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Tranche</Label>
                            <Select value={selectedTranche} onValueChange={setSelectedTranche}>
                              <SelectTrigger data-testid="select-tranche">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="senior">Senior (Low Risk)</SelectItem>
                                <SelectItem value="mezz">Mezzanine (Medium Risk)</SelectItem>
                                <SelectItem value="equity">Equity (High Risk)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            onClick={handleAddJudgment}
                            disabled={addJudgmentMutation.isPending || !selectedJudgmentId}
                            data-testid="button-confirm-add"
                          >
                            {addJudgmentMutation.isPending ? "Adding..." : "Add to Bundle"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <Label className="text-xs text-muted-foreground">Total Judgments</Label>
                      <p className="text-2xl font-bold font-mono" data-testid="total-judgments">{overallTotals.count}</p>
                    </div>
                    <div className="text-center">
                      <Label className="text-xs text-muted-foreground">Total Face Value</Label>
                      <p className="text-2xl font-bold font-mono" data-testid="total-face-value">
                        ${overallTotals.faceValue.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-center">
                      <Label className="text-xs text-muted-foreground">Est. Purchase</Label>
                      <p className="text-2xl font-bold font-mono" data-testid="total-purchase">
                        ${overallTotals.recommendedPurchase.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { name: "Senior Tranche", tranche: "senior", color: "border-l-blue-500", bgColor: "bg-blue-50 dark:bg-blue-950/20", totals: seniorTotals },
                  { name: "Mezzanine Tranche", tranche: "mezz", color: "border-l-amber-500", bgColor: "bg-amber-50 dark:bg-amber-950/20", totals: mezzTotals },
                  { name: "Equity Tranche", tranche: "equity", color: "border-l-green-500", bgColor: "bg-green-50 dark:bg-green-950/20", totals: equityTotals },
                ].map(({ name, tranche, color, bgColor, totals }) => (
                  <Card key={tranche} className={`border-l-4 ${color}`}>
                    <CardHeader className={`${bgColor} pb-3`}>
                      <CardTitle className="text-base">{name}</CardTitle>
                      <CardDescription className="text-xs">
                        {tranche === "senior" && "Lowest risk, priority recovery"}
                        {tranche === "mezz" && "Medium risk, balanced returns"}
                        {tranche === "equity" && "Higher risk, upside potential"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-4">
                      <div className="grid grid-cols-2 gap-2 text-sm pb-3 border-b">
                        <div>
                          <Label className="text-xs text-muted-foreground">Count</Label>
                          <p className="font-semibold" data-testid={`${tranche}-count`}>{totals.count}</p>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Face Value</Label>
                          <p className="font-semibold font-mono text-xs" data-testid={`${tranche}-face-value`}>
                            ${totals.faceValue.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {bundleDetail?.judgments
                          ?.filter((bj) => bj.tranche === tranche)
                          .map((bj) => (
                            <div
                              key={bj.id}
                              className="flex items-start justify-between gap-2 p-2 rounded-md bg-muted/50"
                              data-testid={`${tranche}-judgment-${bj.judgmentId}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">
                                  {bj.judgment.debtorName}
                                </p>
                                <p className="text-xs font-mono text-muted-foreground">
                                  ${parseFloat(bj.judgment.judgmentAmount || "0").toLocaleString()}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleRemoveJudgment(bj.judgmentId)}
                                data-testid={`button-remove-${bj.judgmentId}`}
                              >
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        {bundleDetail?.judgments?.filter((bj) => bj.tranche === tranche).length === 0 && (
                          <div className="text-center py-6">
                            <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                            <p className="text-xs text-muted-foreground">No judgments in this tranche</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <Card className="h-full flex items-center justify-center min-h-[400px]">
              <CardContent className="text-center py-12">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Bundle Selected</h3>
                <p className="text-sm text-muted-foreground">
                  Select a bundle or create a new one to start building portfolios
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
