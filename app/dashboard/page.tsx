'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, FileSpreadsheet, TrendingUp, Calendar, ArrowUp, ArrowDown, PieChart } from 'lucide-react';
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
} from 'recharts';

interface DashboardStats {
  totalShareholders: number;
  activeShareholders: number;
  totalShares: number;
  lastUpload: {
    date: string;
    fileName: string;
    recordCount: number;
  } | null;
  totalUploads: number;
  latestDataDate: string | null;
  changes: {
    shareholdersChange: number;
    sharesChange: number;
    shareholdersChangePercent: number;
    sharesChangePercent: number;
  } | null;
}

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
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (session) {
      fetchStats();
      fetchAnalytics();
    }
  }, [session]);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/dashboard/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await fetch('/api/analytics/trends');
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-600">Welcome back, {session.user.name}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Shareholders</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.activeShareholders.toLocaleString() || 0}
            </div>
            {stats?.changes && stats.changes.shareholdersChange !== 0 && (
              <p className="text-xs flex items-center gap-1">
                {stats.changes.shareholdersChange > 0 ? (
                  <ArrowUp className="h-3 w-3 text-green-600" />
                ) : (
                  <ArrowDown className="h-3 w-3 text-red-600" />
                )}
                <span className={stats.changes.shareholdersChange > 0 ? 'text-green-600' : 'text-red-600'}>
                  {Math.abs(stats.changes.shareholdersChange)} ({stats.changes.shareholdersChangePercent}%)
                </span>
              </p>
            )}
            {!stats?.activeShareholders && (
              <p className="text-xs text-muted-foreground">No data uploaded yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Shares</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalShares.toLocaleString() || 0}
            </div>
            {stats?.changes && stats.changes.sharesChange !== 0 && (
              <p className="text-xs flex items-center gap-1">
                {stats.changes.sharesChange > 0 ? (
                  <ArrowUp className="h-3 w-3 text-green-600" />
                ) : (
                  <ArrowDown className="h-3 w-3 text-red-600" />
                )}
                <span className={stats.changes.sharesChange > 0 ? 'text-green-600' : 'text-red-600'}>
                  {Math.abs(stats.changes.sharesChange).toLocaleString()} ({stats.changes.sharesChangePercent}%)
                </span>
              </p>
            )}
            {!stats?.totalShares && (
              <p className="text-xs text-muted-foreground">Upload data to see metrics</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last Upload</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.lastUpload ? new Date(stats.lastUpload.date).toLocaleDateString() : '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.lastUpload ? `${stats.lastUpload.recordCount} records` : 'No uploads yet'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Files</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalUploads || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.latestDataDate 
                ? `Latest: ${new Date(stats.latestDataDate).toLocaleDateString()}`
                : 'Upload Excel or CSV files'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Charts */}
      {analytics && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Shareholder Trends</CardTitle>
              <CardDescription>
                Number of shareholders over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.trends && analytics.trends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={analytics.trends}>
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
                    <Line
                      type="monotone"
                      dataKey="totalShareholders"
                      stroke="#3b82f6"
                      name="Shareholders"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-500">
                  No data available. Upload shareholder data to see trends.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ownership Distribution</CardTitle>
              <CardDescription>
                Distribution by ownership percentage
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.distribution && analytics.distribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <RePieChart>
                    <Pie
                      data={analytics.distribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.range}: ${entry.count}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {analytics.distribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RePieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-500">
                  No data available. Upload shareholder data to see distribution.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top 10 Shareholders</CardTitle>
              <CardDescription>
                Largest shareholders by share count
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.topShareholders && analytics.topShareholders.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.topShareholders.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis />
                    <Tooltip formatter={(value: any) => value.toLocaleString()} />
                    <Bar dataKey="shares" fill="#10b981" name="Shares" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-500">
                  No data available. Upload shareholder data to see top shareholders.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Share Volume Distribution</CardTitle>
              <CardDescription>
                Total shares by ownership group
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.distribution && analytics.distribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" />
                    <YAxis />
                    <Tooltip formatter={(value: any) => value.toLocaleString()} />
                    <Bar dataKey="totalShares" fill="#f59e0b" name="Total Shares" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-500">
                  No data available. Upload shareholder data to see volume distribution.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {session.user.isAdmin && (
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            Admin access enabled. You can manage users and system settings.
          </p>
        </div>
      )}
    </div>
  );
}