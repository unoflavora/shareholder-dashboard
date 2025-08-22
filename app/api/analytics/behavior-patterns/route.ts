import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql, and, gte, lte, eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const threshold = parseFloat(searchParams.get('threshold') || '0.2'); // Minimum correlation threshold

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    // Get all shareholdings within the date range
    const shareholdingsData = await db
      .select({
        shareholderId: shareholdings.shareholderId,
        shareholderName: shareholders.name,
        date: shareholdings.date,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
      })
      .from(shareholdings)
      .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
      .where(and(
        gte(shareholdings.date, startDate),
        lte(shareholdings.date, endDate)
      ))
      .orderBy(shareholdings.date, shareholdings.shareholderId);

    // Group by shareholder and create activity profiles
    const shareholderProfiles = new Map();
    
    shareholdingsData.forEach(record => {
      if (!shareholderProfiles.has(record.shareholderId)) {
        shareholderProfiles.set(record.shareholderId, {
          id: record.shareholderId,
          name: record.shareholderName,
          activities: []
        });
      }
      
      const profile = shareholderProfiles.get(record.shareholderId);
      profile.activities.push({
        date: record.date,
        shares: record.shares,
        percentage: record.percentage
      });
    });

    // Analyze each shareholder's activity pattern
    const activityPatterns = new Map();
    
    for (const [shareholderId, profile] of shareholderProfiles) {
      const activities = profile.activities.sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      if (activities.length < 2) continue;
      
      const pattern = {
        shareholderId: shareholderId,
        name: profile.name,
        buyingDates: [],
        sellingDates: [],
        accumulation: 0,
        reduction: 0,
        netChange: 0,
        volatility: 0,
        behavior: 'stable'
      };
      
      // Analyze changes between consecutive records
      for (let i = 1; i < activities.length; i++) {
        const change = activities[i].shares - activities[i-1].shares;
        if (change > 0) {
          pattern.buyingDates.push(activities[i].date);
          pattern.accumulation += change;
        } else if (change < 0) {
          pattern.sellingDates.push(activities[i].date);
          pattern.reduction += Math.abs(change);
        }
      }
      
      pattern.netChange = activities[activities.length - 1].shares - activities[0].shares;
      
      // Calculate volatility (standard deviation of changes)
      const changes = [];
      for (let i = 1; i < activities.length; i++) {
        changes.push(activities[i].shares - activities[i-1].shares);
      }
      if (changes.length > 0) {
        const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
        const variance = changes.reduce((sum, change) => 
          sum + Math.pow(change - avgChange, 2), 0) / changes.length;
        pattern.volatility = Math.sqrt(variance);
      }
      
      // Classify behavior
      if (pattern.buyingDates.length > 0 && pattern.sellingDates.length === 0) {
        pattern.behavior = 'pure_accumulator';
      } else if (pattern.sellingDates.length > 0 && pattern.buyingDates.length === 0) {
        pattern.behavior = 'pure_seller';
      } else if (pattern.buyingDates.length > pattern.sellingDates.length * 2) {
        pattern.behavior = 'net_accumulator';
      } else if (pattern.sellingDates.length > pattern.buyingDates.length * 2) {
        pattern.behavior = 'net_seller';
      } else if (pattern.volatility > 10000) {
        pattern.behavior = 'high_volatility_trader';
      } else {
        pattern.behavior = 'balanced_trader';
      }
      
      activityPatterns.set(shareholderId, pattern);
    }

    // Find correlated groups (shareholders who buy/sell on similar dates)
    const correlatedGroups = [];
    const processedPairs = new Set();
    
    for (const [id1, pattern1] of activityPatterns) {
      for (const [id2, pattern2] of activityPatterns) {
        if (id1 >= id2) continue; // Avoid duplicates and self-comparison
        
        const pairKey = `${id1}-${id2}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);
        
        // Calculate correlation based on overlapping activity dates
        const buyingOverlap = pattern1.buyingDates.filter(date => 
          pattern2.buyingDates.includes(date)
        ).length;
        const sellingOverlap = pattern1.sellingDates.filter(date => 
          pattern2.sellingDates.includes(date)
        ).length;
        
        const totalActivities1 = pattern1.buyingDates.length + pattern1.sellingDates.length;
        const totalActivities2 = pattern2.buyingDates.length + pattern2.sellingDates.length;
        const totalOverlap = buyingOverlap + sellingOverlap;
        
        if (totalActivities1 > 0 && totalActivities2 > 0) {
          const correlation = (totalOverlap * 2) / (totalActivities1 + totalActivities2);
          
          if (correlation >= threshold) {
            correlatedGroups.push({
              shareholders: [
                { id: id1, name: pattern1.name },
                { id: id2, name: pattern2.name }
              ],
              correlation: correlation,
              buyingOverlapDates: pattern1.buyingDates.filter(date => 
                pattern2.buyingDates.includes(date)
              ),
              sellingOverlapDates: pattern1.sellingDates.filter(date => 
                pattern2.sellingDates.includes(date)
              ),
              totalOverlapEvents: totalOverlap
            });
          }
        }
      }
    }
    
    // Sort correlated groups by correlation strength
    correlatedGroups.sort((a, b) => b.correlation - a.correlation);

    // Identify larger groups (more than 2 shareholders acting together)
    const dateActivityMap = new Map();
    
    for (const [shareholderId, pattern] of activityPatterns) {
      pattern.buyingDates.forEach(date => {
        if (!dateActivityMap.has(date)) {
          dateActivityMap.set(date, { buyers: [], sellers: [] });
        }
        dateActivityMap.get(date).buyers.push({ id: shareholderId, name: pattern.name });
      });
      
      pattern.sellingDates.forEach(date => {
        if (!dateActivityMap.has(date)) {
          dateActivityMap.set(date, { buyers: [], sellers: [] });
        }
        dateActivityMap.get(date).sellers.push({ id: shareholderId, name: pattern.name });
      });
    }
    
    // Find dates with coordinated activity
    const coordinatedActivities = [];
    for (const [date, activity] of dateActivityMap) {
      if (activity.buyers.length >= 3) {
        coordinatedActivities.push({
          date: date,
          type: 'coordinated_buying',
          participants: activity.buyers,
          count: activity.buyers.length
        });
      }
      if (activity.sellers.length >= 3) {
        coordinatedActivities.push({
          date: date,
          type: 'coordinated_selling',
          participants: activity.sellers,
          count: activity.sellers.length
        });
      }
    }
    
    coordinatedActivities.sort((a, b) => b.count - a.count);

    // Behavior statistics
    const behaviorCounts = {
      pure_accumulator: 0,
      pure_seller: 0,
      net_accumulator: 0,
      net_seller: 0,
      high_volatility_trader: 0,
      balanced_trader: 0
    };
    
    for (const pattern of activityPatterns.values()) {
      behaviorCounts[pattern.behavior]++;
    }

    // Identify potential pump-and-dump patterns
    const suspiciousPatterns = [];
    for (const [shareholderId, pattern] of activityPatterns) {
      // Look for: accumulation followed by complete sell-off
      if (pattern.buyingDates.length > 0 && pattern.sellingDates.length > 0) {
        const lastBuyDate = new Date(pattern.buyingDates[pattern.buyingDates.length - 1]);
        const firstSellDate = new Date(pattern.sellingDates[0]);
        
        if (firstSellDate > lastBuyDate && pattern.reduction >= pattern.accumulation * 0.8) {
          suspiciousPatterns.push({
            shareholderId: shareholderId,
            name: pattern.name,
            accumulation: pattern.accumulation,
            reduction: pattern.reduction,
            accumulationPeriod: {
              start: pattern.buyingDates[0],
              end: pattern.buyingDates[pattern.buyingDates.length - 1]
            },
            sellOffPeriod: {
              start: pattern.sellingDates[0],
              end: pattern.sellingDates[pattern.sellingDates.length - 1]
            },
            pattern: 'accumulate_then_dump'
          });
        }
      }
    }

    return NextResponse.json({
      summary: {
        totalAnalyzed: activityPatterns.size,
        behaviorCounts,
        correlatedGroupsFound: correlatedGroups.length,
        coordinatedActivitiesFound: coordinatedActivities.length,
        suspiciousPatternsFound: suspiciousPatterns.length,
        period: {
          start: startDate,
          end: endDate
        }
      },
      behaviorPatterns: Array.from(activityPatterns.values()).slice(0, 50),
      correlatedGroups: correlatedGroups.slice(0, 20),
      coordinatedActivities: coordinatedActivities.slice(0, 20),
      suspiciousPatterns: suspiciousPatterns.slice(0, 10)
    });
  } catch (error) {
    console.error('Error analyzing behavior patterns:', error);
    return NextResponse.json(
      { error: 'Failed to analyze behavior patterns' },
      { status: 500 }
    );
  }
}