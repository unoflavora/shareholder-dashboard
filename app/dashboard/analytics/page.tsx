'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, TrendingUp, Users, PieChart, BarChart3, Download, Search, ArrowUp, ArrowDown } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { toast } from 'sonner';

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
  distribution: Array<{
    range: string;
    count: number;
    totalShares: number;
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

interface ShareholderGrowthData {
  shareholder: {
    id: number;
    name: string;
  };
  growthData: Array<{
    date: string;
    shares: number;
    percentage: number;
  }>;
  metrics: {
    initialShares: number;
    finalShares: number;
    sharesChange: number;
    sharesChangePercent: number;
    initialPercentage: number;
    finalPercentage: number;
    percentageChange: number;
    dateRange: {
      start: string;
      end: string;
    };
  } | null;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export default function AnalyticsPage() {
  const searchParams = useSearchParams();
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [shareholderGrowth, setShareholderGrowth] = useState<ShareholderGrowthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dates, setDates] = useState<string[]>([]);
  const [date1, setDate1] = useState('');
  const [date2, setDate2] = useState('');
  const [isComparing, setIsComparing] = useState(false);
  const [activeTab, setActiveTab] = useState('trends');
  
  // Shareholder growth filters
  const [shareholderSearch, setShareholderSearch] = useState('');
  const [selectedShareholderId, setSelectedShareholderId] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Array<{id: number; name: string}>>([]);
  const [growthStartDate, setGrowthStartDate] = useState('');
  const [growthEndDate, setGrowthEndDate] = useState('');
  const [isLoadingGrowth, setIsLoadingGrowth] = useState(false);

  useEffect(() => {
    fetchAnalytics();
    fetchDates();
    
    // Handle URL parameters
    const tab = searchParams.get('tab');
    const shareholderId = searchParams.get('shareholderId');
    const name = searchParams.get('name');
    
    if (tab) {
      setActiveTab(tab);
    }
    
    if (shareholderId && name) {
      setSelectedShareholderId(shareholderId);
      setShareholderSearch(name);
      // Auto-fetch growth data if shareholder is pre-selected
      setTimeout(() => {
        if (shareholderId) {
          fetchShareholderGrowthWithId(shareholderId);
        }
      }, 500);
    }
  }, [searchParams]);

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

  const searchShareholders = async (query: string) => {
    if (!query) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await fetch(`/api/shareholders/growth?search=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.searchResults || []);
      }
    } catch (error) {
      console.error('Error searching shareholders:', error);
    }
  };

  const fetchShareholderGrowth = async () => {
    if (!selectedShareholderId) {
      toast.error('Please select a shareholder');
      return;
    }

    setIsLoadingGrowth(true);
    try {
      const params = new URLSearchParams({
        shareholderId: selectedShareholderId,
      });
      
      if (growthStartDate) params.append('startDate', growthStartDate);
      if (growthEndDate) params.append('endDate', growthEndDate);

      const response = await fetch(`/api/shareholders/growth?${params}`);
      if (response.ok) {
        const data = await response.json();
        setShareholderGrowth(data);
      } else {
        toast.error('Failed to fetch growth data');
      }
    } catch (error) {
      console.error('Error fetching growth data:', error);
      toast.error('Failed to fetch growth data');
    } finally {
      setIsLoadingGrowth(false);
    }
  };

  const fetchShareholderGrowthWithId = async (shareholderId: string) => {
    setIsLoadingGrowth(true);
    try {
      const params = new URLSearchParams({
        shareholderId: shareholderId,
      });
      
      if (growthStartDate) params.append('startDate', growthStartDate);
      if (growthEndDate) params.append('endDate', growthEndDate);

      const response = await fetch(`/api/shareholders/growth?${params}`);
      if (response.ok) {
        const data = await response.json();
        setShareholderGrowth(data);
      } else {
        toast.error('Failed to fetch growth data');
      }
    } catch (error) {
      console.error('Error fetching growth data:', error);
      toast.error('Failed to fetch growth data');
    } finally {
      setIsLoadingGrowth(false);
    }
  };

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      searchShareholders(shareholderSearch);
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [shareholderSearch]);

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
        <p className="text-gray-600">Analyze shareholder trends and distributions</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="trends">
            <TrendingUp className="mr-2 h-4 w-4" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="distribution">
            <PieChart className="mr-2 h-4 w-4" />
            Distribution
          </TabsTrigger>
          <TabsTrigger value="comparison">
            <BarChart3 className="mr-2 h-4 w-4" />
            Comparison
          </TabsTrigger>
          <TabsTrigger value="top">
            <Users className="mr-2 h-4 w-4" />
            Top Shareholders
          </TabsTrigger>
          <TabsTrigger value="growth">
            <TrendingUp className="mr-2 h-4 w-4" />
            Individual Growth
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

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Ownership Distribution</CardTitle>
                <CardDescription>
                  Distribution of shareholders by ownership percentage
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RePieChart>
                    <Pie
                      data={analyticsData?.distribution || []}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.range}: ${entry.count}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {analyticsData?.distribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RePieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Share Volume Distribution</CardTitle>
                <CardDescription>
                  Total shares held by each ownership group
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analyticsData?.distribution || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" />
                    <YAxis />
                    <Tooltip formatter={(value: any) => value.toLocaleString()} />
                    <Bar dataKey="totalShares" fill="#3b82f6" name="Total Shares" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
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

        <TabsContent value="growth" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Shareholder Growth Analysis</CardTitle>
              <CardDescription>
                Track individual shareholder growth over time
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label htmlFor="shareholder-search">Search Shareholder</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
                    <Input
                      id="shareholder-search"
                      placeholder="Type shareholder name..."
                      value={shareholderSearch}
                      onChange={(e) => setShareholderSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-2 border rounded-md max-h-48 overflow-y-auto">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            setSelectedShareholderId(result.id.toString());
                            setShareholderSearch(result.name);
                            setSearchResults([]);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          {result.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="growth-start-date">Start Date</Label>
                  <Input
                    id="growth-start-date"
                    type="date"
                    value={growthStartDate}
                    onChange={(e) => setGrowthStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="growth-end-date">End Date</Label>
                  <Input
                    id="growth-end-date"
                    type="date"
                    value={growthEndDate}
                    onChange={(e) => setGrowthEndDate(e.target.value)}
                  />
                </div>
              </div>

              <Button 
                onClick={fetchShareholderGrowth} 
                disabled={!selectedShareholderId || isLoadingGrowth}
                className="w-full md:w-auto"
              >
                {isLoadingGrowth && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Analyze Growth
              </Button>

              {shareholderGrowth && shareholderGrowth.growthData.length > 0 && (
                <>
                  {shareholderGrowth.metrics && (
                    <div className="grid gap-4 md:grid-cols-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">
                            {shareholderGrowth.metrics.finalShares.toLocaleString()}
                          </div>
                          <p className="text-xs text-muted-foreground">Current Shares</p>
                          <p className="text-sm mt-2 flex items-center">
                            {shareholderGrowth.metrics.sharesChange > 0 ? (
                              <ArrowUp className="h-3 w-3 text-green-600 mr-1" />
                            ) : shareholderGrowth.metrics.sharesChange < 0 ? (
                              <ArrowDown className="h-3 w-3 text-red-600 mr-1" />
                            ) : null}
                            <span className={
                              shareholderGrowth.metrics.sharesChange > 0 ? 'text-green-600' :
                              shareholderGrowth.metrics.sharesChange < 0 ? 'text-red-600' : ''
                            }>
                              {shareholderGrowth.metrics.sharesChange > 0 ? '+' : ''}
                              {shareholderGrowth.metrics.sharesChange.toLocaleString()}
                            </span>
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">
                            {shareholderGrowth.metrics.sharesChangePercent}%
                          </div>
                          <p className="text-xs text-muted-foreground">Growth Rate</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">
                            {shareholderGrowth.metrics.finalPercentage.toFixed(4)}%
                          </div>
                          <p className="text-xs text-muted-foreground">Current Ownership</p>
                          <p className="text-sm mt-2">
                            <span className={
                              shareholderGrowth.metrics.percentageChange > 0 ? 'text-green-600' :
                              shareholderGrowth.metrics.percentageChange < 0 ? 'text-red-600' : ''
                            }>
                              {shareholderGrowth.metrics.percentageChange > 0 ? '+' : ''}
                              {shareholderGrowth.metrics.percentageChange.toFixed(4)}%
                            </span>
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">
                            {shareholderGrowth.growthData.length}
                          </div>
                          <p className="text-xs text-muted-foreground">Data Points</p>
                          <p className="text-xs mt-2 text-gray-500">
                            {new Date(shareholderGrowth.metrics.dateRange.start).toLocaleDateString()} - 
                            {new Date(shareholderGrowth.metrics.dateRange.end).toLocaleDateString()}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>Share Growth Over Time</CardTitle>
                      <CardDescription>
                        {shareholderGrowth.shareholder.name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={shareholderGrowth.growthData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="date" 
                            tickFormatter={(value) => new Date(value).toLocaleDateString()}
                          />
                          <YAxis yAxisId="left" />
                          <YAxis yAxisId="right" orientation="right" />
                          <Tooltip 
                            labelFormatter={(value) => new Date(value).toLocaleDateString()}
                            formatter={(value: any, name: string) => [
                              name === 'shares' ? value.toLocaleString() : `${value.toFixed(4)}%`,
                              name === 'shares' ? 'Shares' : 'Ownership %'
                            ]}
                          />
                          <Legend />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="shares"
                            stroke="#3b82f6"
                            name="Shares"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="percentage"
                            stroke="#10b981"
                            name="Ownership %"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Ownership Percentage Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={shareholderGrowth.growthData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="date" 
                            tickFormatter={(value) => new Date(value).toLocaleDateString()}
                          />
                          <YAxis />
                          <Tooltip 
                            labelFormatter={(value) => new Date(value).toLocaleDateString()}
                            formatter={(value: any) => `${value.toFixed(4)}%`}
                          />
                          <Area
                            type="monotone"
                            dataKey="percentage"
                            stroke="#8b5cf6"
                            fill="#8b5cf6"
                            fillOpacity={0.3}
                            name="Ownership %"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </>
              )}

              {shareholderGrowth && shareholderGrowth.growthData.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No data found for the selected shareholder and date range.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}