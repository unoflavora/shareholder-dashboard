'use client';

import { useState, useEffect, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, TrendingUp, Users, BarChart3, Calendar, TrendingDown, UserPlus, Users2, Target } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { toast } from 'sonner';

// Import new analytics components
import ActiveBuyersAnalysis from '@/app/components/analytics/ActiveBuyersAnalysis';
import ActiveSellersAnalysis from '@/app/components/analytics/ActiveSellersAnalysis';
import NewShareholdersAnalysis from '@/app/components/analytics/NewShareholdersAnalysis';
import BehaviorPatterns from '@/app/components/analytics/BehaviorPatterns';
import TimingAnalysis from '@/app/components/analytics/TimingAnalysis';

interface AnalyticsData {
  trends: Array<{
    date: string;
    totalShareholders: number;
    totalShares: number;
    averageShares: number;
  }>;
  topShareholders: Array<{
    name: string;
    shares: number;
    percentage: number;
  }>;
  monthlyData: Array<{
    month: string;
    avgShareholders: number;
    avgShares: number;
  }>;
  latestDate: string;
}

interface ComparisonData {
  date1: any;
  date2: any;
  comparison: any;
  details: any;
}

function AnalyticsContent() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dates, setDates] = useState<string[]>([]);
  const [date1, setDate1] = useState('');
  const [date2, setDate2] = useState('');
  const [isComparing, setIsComparing] = useState(false);
  const [activeTab, setActiveTab] = useState('trends');
  
  // Period selection for new analytics
  const [periodStartDate, setPeriodStartDate] = useState('');
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [periodType, setPeriodType] = useState<'daily' | 'monthly'>('daily');

  useEffect(() => {
    fetchAnalytics();
    fetchDates();
    
    // Set default period dates (last 30 days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setPeriodEndDate(end.toISOString().split('T')[0]);
    setPeriodStartDate(start.toISOString().split('T')[0]);
  }, []);

  const fetchAnalytics = async () => {
    try {
      const response = await fetch('/api/analytics/trends');
      if (response.ok) {
        const data = await response.json();
        setAnalyticsData(data);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      toast.error('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDates = async () => {
    try {
      const response = await fetch('/api/shareholders/dates');
      if (response.ok) {
        const data = await response.json();
        setDates(data.dates);
        if (data.dates.length >= 2) {
          setDate1(data.dates[1]);
          setDate2(data.dates[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching dates:', error);
    }
  };

  const handleCompare = async () => {
    if (!date1 || !date2) {
      toast.error('Please select both dates');
      return;
    }

    setIsComparing(true);
    try {
      const response = await fetch(`/api/shareholders/compare?date1=${date1}&date2=${date2}`);
      if (response.ok) {
        const data = await response.json();
        setComparisonData(data);
      } else {
        toast.error('Failed to compare dates');
      }
    } catch (error) {
      console.error('Error comparing dates:', error);
      toast.error('Failed to compare dates');
    } finally {
      setIsComparing(false);
    }
  };

  const handleSetPeriodToMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    setPeriodStartDate(firstDay.toISOString().split('T')[0]);
    setPeriodEndDate(now.toISOString().split('T')[0]);
  };

  const handleSetPeriodToQuarter = () => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const firstMonth = quarter * 3;
    const firstDay = new Date(now.getFullYear(), firstMonth, 1);
    setPeriodStartDate(firstDay.toISOString().split('T')[0]);
    setPeriodEndDate(now.toISOString().split('T')[0]);
  };

  const handleSetPeriodToYear = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), 0, 1);
    setPeriodStartDate(firstDay.toISOString().split('T')[0]);
    setPeriodEndDate(now.toISOString().split('T')[0]);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="text-gray-600">Analyze shareholder patterns and behaviors</p>
      </div>

      {/* Period Selector for New Analytics */}
      <Card>
        <CardHeader>
          <CardTitle>Period Selection</CardTitle>
          <CardDescription>
            Select the time period for analytics
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="period-type">Period Type</Label>
              <Select value={periodType} onValueChange={(value: 'daily' | 'monthly') => setPeriodType(value)}>
                <SelectTrigger id="period-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Quick Select</Label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSetPeriodToMonth}>
                  This Month
                </Button>
                <Button variant="outline" size="sm" onClick={handleSetPeriodToQuarter}>
                  This Quarter
                </Button>
                <Button variant="outline" size="sm" onClick={handleSetPeriodToYear}>
                  This Year
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-8">
          <TabsTrigger value="trends">
            <TrendingUp className="mr-2 h-4 w-4" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="buyers">
            <TrendingUp className="mr-2 h-4 w-4" />
            Buyers
          </TabsTrigger>
          <TabsTrigger value="sellers">
            <TrendingDown className="mr-2 h-4 w-4" />
            Sellers
          </TabsTrigger>
          <TabsTrigger value="new">
            <UserPlus className="mr-2 h-4 w-4" />
            New
          </TabsTrigger>
          <TabsTrigger value="patterns">
            <Users2 className="mr-2 h-4 w-4" />
            Patterns
          </TabsTrigger>
          <TabsTrigger value="timing">
            <Target className="mr-2 h-4 w-4" />
            Timing
          </TabsTrigger>
          <TabsTrigger value="comparison">
            <BarChart3 className="mr-2 h-4 w-4" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="top">
            <Users className="mr-2 h-4 w-4" />
            Top
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Shareholder Trends Over Time</CardTitle>
              <CardDescription>
                Track the number of shareholders and total shares over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={analyticsData?.trends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => new Date(value).toLocaleDateString()}
                  />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip 
                    labelFormatter={(value) => new Date(value).toLocaleDateString()}
                    formatter={(value: any) => value.toLocaleString()}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="totalShareholders"
                    stroke="#3b82f6"
                    name="Total Shareholders"
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="totalShares"
                    stroke="#10b981"
                    name="Total Shares"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Average Shares Per Shareholder</CardTitle>
              <CardDescription>
                Track the average shareholding over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={analyticsData?.trends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => new Date(value).toLocaleDateString()}
                  />
                  <YAxis />
                  <Tooltip 
                    labelFormatter={(value) => new Date(value).toLocaleDateString()}
                    formatter={(value: any) => value.toLocaleString()}
                  />
                  <Area
                    type="monotone"
                    dataKey="averageShares"
                    stroke="#8b5cf6"
                    fill="#8b5cf6"
                    fillOpacity={0.3}
                    name="Average Shares"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyers" className="space-y-4">
          <ActiveBuyersAnalysis 
            startDate={periodStartDate}
            endDate={periodEndDate}
            periodType={periodType}
          />
        </TabsContent>

        <TabsContent value="sellers" className="space-y-4">
          <ActiveSellersAnalysis 
            startDate={periodStartDate}
            endDate={periodEndDate}
            periodType={periodType}
          />
        </TabsContent>

        <TabsContent value="new" className="space-y-4">
          <NewShareholdersAnalysis 
            startDate={periodStartDate}
            endDate={periodEndDate}
            periodType={periodType}
          />
        </TabsContent>

        <TabsContent value="patterns" className="space-y-4">
          <BehaviorPatterns 
            startDate={periodStartDate}
            endDate={periodEndDate}
          />
        </TabsContent>

        <TabsContent value="timing" className="space-y-4">
          <TimingAnalysis 
            startDate={periodStartDate}
            endDate={periodEndDate}
          />
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Date Comparison</CardTitle>
              <CardDescription>
                Compare shareholder data between two dates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-medium">From Date</label>
                  <Select value={date1} onValueChange={setDate1}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select date" />
                    </SelectTrigger>
                    <SelectContent>
                      {dates.map((date) => (
                        <SelectItem key={date} value={date}>
                          {new Date(date).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">To Date</label>
                  <Select value={date2} onValueChange={setDate2}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select date" />
                    </SelectTrigger>
                    <SelectContent>
                      {dates.map((date) => (
                        <SelectItem key={date} value={date}>
                          {new Date(date).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={handleCompare} disabled={isComparing} className="w-full">
                    {isComparing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Compare
                  </Button>
                </div>
              </div>

              {comparisonData && (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-4">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-2xl font-bold text-green-600">
                          +{comparisonData.comparison.newCount}
                        </div>
                        <p className="text-xs text-muted-foreground">New Shareholders</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-2xl font-bold text-red-600">
                          -{comparisonData.comparison.removedCount}
                        </div>
                        <p className="text-xs text-muted-foreground">Removed</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-2xl font-bold text-blue-600">
                          {comparisonData.comparison.changedCount}
                        </div>
                        <p className="text-xs text-muted-foreground">Changed</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-2xl font-bold text-gray-600">
                          {comparisonData.comparison.unchangedCount}
                        </div>
                        <p className="text-xs text-muted-foreground">Unchanged</p>
                      </CardContent>
                    </Card>
                  </div>

                  {comparisonData.details.changed.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Top Changes</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {comparisonData.details.changed.slice(0, 10).map((item: any, index: number) => (
                            <div key={index} className="flex justify-between items-center text-sm">
                              <span>{item.name}</span>
                              <span className={item.sharesChange > 0 ? 'text-green-600' : 'text-red-600'}>
                                {item.sharesChange > 0 ? '+' : ''}{item.sharesChange.toLocaleString()} shares
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="top" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Shareholders</CardTitle>
              <CardDescription>
                Largest shareholders by share count for {analyticsData?.latestDate ? new Date(analyticsData.latestDate).toLocaleDateString() : 'latest date'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart 
                  data={analyticsData?.topShareholders || []}
                  layout="horizontal"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={150}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip formatter={(value: any) => value.toLocaleString()} />
                  <Bar dataKey="shares" fill="#3b82f6" name="Shares" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    }>
      <AnalyticsContent />
    </Suspense>
  );
}