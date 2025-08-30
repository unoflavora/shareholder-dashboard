'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Users, AlertTriangle, Activity, Download } from 'lucide-react';
import { toast } from 'sonner';

interface BehaviorPatternsProps {
  startDate: string;
  endDate: string;
}

export default function BehaviorPatterns({ startDate, endDate }: BehaviorPatternsProps) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);

  const fetchData = async () => {
    if (!startDate || !endDate) return;
    
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        threshold: '0.2' // 20% correlation threshold
      });
      
      const response = await fetch(`/api/analytics/behavior-patterns?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        toast.error('Failed to fetch behavior patterns');
      }
    } catch (error) {
      console.error('Error fetching behavior patterns:', error);
      toast.error('An error occurred while fetching data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const getBehaviorBadge = (behavior: string) => {
    const variants: Record<string, any> = {
      pure_accumulator: { variant: 'default', className: 'bg-green-100 text-green-800' },
      pure_seller: { variant: 'default', className: 'bg-red-100 text-red-800' },
      net_accumulator: { variant: 'default', className: 'bg-blue-100 text-blue-800' },
      net_seller: { variant: 'default', className: 'bg-orange-100 text-orange-800' },
      high_volatility_trader: { variant: 'default', className: 'bg-purple-100 text-purple-800' },
      balanced_trader: { variant: 'secondary' }
    };
    
    const config = variants[behavior] || { variant: 'outline' };
    return <Badge {...config}>{behavior.replace(/_/g, ' ').toUpperCase()}</Badge>;
  };

  const exportData = () => {
    if (!data) return;
    
    // Export correlated groups
    const csv = [
      ['Group Type', 'Participants', 'Correlation', 'Overlap Events'],
      ...data.correlatedGroups.map((group: any) => [
        'Correlated Pair',
        group.shareholders.map((s: any) => s.name).join(' & '),
        (group.correlation * 100).toFixed(1) + '%',
        group.totalOverlapEvents
      ]),
      [''],
      ['Coordinated Activities'],
      ['Date', 'Type', 'Participants Count', 'Names'],
      ...data.coordinatedActivities.map((activity: any) => [
        activity.date,
        activity.type,
        activity.count,
        activity.participants.slice(0, 5).map((p: any) => p.name).join(', ')
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `behavior-patterns-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center p-8 text-gray-500">No data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{data.summary.totalAnalyzed}</div>
            <p className="text-xs text-muted-foreground">Shareholders Analyzed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold flex items-center">
              <Users className="h-5 w-5 mr-2 text-blue-600" />
              {data.summary.correlatedGroupsFound}
            </div>
            <p className="text-xs text-muted-foreground">Correlated Groups</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold flex items-center">
              <Activity className="h-5 w-5 mr-2 text-purple-600" />
              {data.summary.coordinatedActivitiesFound}
            </div>
            <p className="text-xs text-muted-foreground">Coordinated Activities</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-orange-600" />
              {data.summary.suspiciousPatternsFound}
            </div>
            <p className="text-xs text-muted-foreground">Suspicious Patterns</p>
          </CardContent>
        </Card>
      </div>

      {/* Behavior Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Behavior Type Distribution</CardTitle>
          <CardDescription>
            Classification of shareholder trading behaviors
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(data.summary.behaviorCounts).map(([behavior, count]: [string, any]) => (
              <div key={behavior} className="flex items-center justify-between p-3 border rounded">
                <div className="flex items-center gap-2">
                  {getBehaviorBadge(behavior)}
                </div>
                <span className="text-2xl font-bold">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Suspicious Patterns Alert */}
      {data.suspiciousPatterns && data.suspiciousPatterns.length > 0 && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Suspicious Trading Patterns Detected</AlertTitle>
          <AlertDescription>
            <div className="mt-3 space-y-2">
              {data.suspiciousPatterns.map((pattern: any, index: number) => (
                <div key={index} className="text-sm">
                  <strong>{pattern.name}</strong>: {pattern.pattern.replace(/_/g, ' ')} - 
                  Accumulated {pattern.accumulation.toLocaleString()} shares then sold {pattern.reduction.toLocaleString()}
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Correlated Groups */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Correlated Trading Groups</CardTitle>
              <CardDescription>
                Shareholders who buy/sell on similar dates
              </CardDescription>
            </div>
            <Button onClick={exportData} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shareholders</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead>Buying Overlap</TableHead>
                  <TableHead>Selling Overlap</TableHead>
                  <TableHead>Total Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.correlatedGroups.slice(0, 10).map((group: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                      {group.shareholders.map((s: any) => s.name).join(' & ')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {(group.correlation * 100).toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>{group.buyingOverlapDates.length} days</TableCell>
                    <TableCell>{group.sellingOverlapDates.length} days</TableCell>
                    <TableCell>{group.totalOverlapEvents}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Coordinated Activities */}
      <Card>
        <CardHeader>
          <CardTitle>Coordinated Group Activities</CardTitle>
          <CardDescription>
            Dates when 3+ shareholders acted together
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Activity Type</TableHead>
                  <TableHead>Participants</TableHead>
                  <TableHead>Names</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.coordinatedActivities.slice(0, 10).map((activity: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>{new Date(activity.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge className={
                        activity.type === 'coordinated_buying' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }>
                        {activity.type.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{activity.count} shareholders</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {activity.participants.slice(0, 3).map((p: any) => p.name).join(', ')}
                      {activity.participants.length > 3 && (
                        <span
                          className="text-blue-600 cursor-pointer hover:text-blue-800 hover:underline ml-1"
                          onClick={() => {
                            setSelectedActivity(activity);
                            setShowParticipantsDialog(true);
                          }}
                        >
                          +{activity.participants.length - 3} more...
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Participants Dialog */}
      <Dialog open={showParticipantsDialog} onOpenChange={setShowParticipantsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Coordinated Activity Participants
            </DialogTitle>
            <DialogDescription>
              {selectedActivity && (
                <>
                  Activity on {new Date(selectedActivity.date).toLocaleDateString()} - 
                  <Badge className={
                    selectedActivity.type === 'coordinated_buying' 
                      ? 'bg-green-100 text-green-800 ml-2' 
                      : 'bg-red-100 text-red-800 ml-2'
                  }>
                    {selectedActivity.type.replace('_', ' ').toUpperCase()}
                  </Badge>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedActivity && (
            <div className="mt-4">
              <div className="text-sm text-gray-600 mb-4">
                Total participants: {selectedActivity.participants.length} shareholders
              </div>
              <div className="grid gap-2">
                {selectedActivity.participants.map((participant: any, index: number) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{participant.name}</span>
                      {participant.accountHolder && (
                        <span className="text-sm text-gray-600">
                          Account: {participant.accountHolder}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {participant.sharesAmount ? participant.sharesAmount.toLocaleString() : '0'} shares
                      </div>
                      <div className="text-xs text-gray-600">
                        {participant.percentage ? parseFloat(participant.percentage.toString()).toFixed(2) : '0.00'}% ownership
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}