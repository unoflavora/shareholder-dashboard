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

    // Get latest shares per day for each shareholder using D-1 vs D logic
    const dailyPositionsQuery = `
      WITH daily_positions AS (
        SELECT 
          s1.shareholder_id,
          s3.name as shareholder_name,
          s3.account_holder,
          s1.date,
          (SELECT s2.shares_amount FROM shareholdings s2 
           WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
           ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares,
          (SELECT s2.percentage FROM shareholdings s2 
           WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
           ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_percentage
        FROM shareholdings s1
        JOIN shareholders s3 ON s1.shareholder_id = s3.id
        WHERE s1.date >= '${startDate}' AND s1.date <= '${endDate}'
        GROUP BY s1.shareholder_id, s3.name, s3.account_holder, s1.date
        ORDER BY s1.date, s1.shareholder_id
      )
      SELECT * FROM daily_positions
    `;

    const dailyPositionsResult = await db.execute(sql.raw(dailyPositionsQuery));
    const dailyPositionsData = dailyPositionsResult[0] || [];

    // Group by shareholder and create activity profiles
    const shareholderProfiles = new Map();
    
    dailyPositionsData.forEach(record => {
      if (!shareholderProfiles.has(record.shareholder_id)) {
        shareholderProfiles.set(record.shareholder_id, {
          id: record.shareholder_id,
          name: record.shareholder_name,
          accountHolder: record.account_holder,
          activities: []
        });
      }
      
      const profile = shareholderProfiles.get(record.shareholder_id);
      profile.activities.push({
        date: record.date,
        shares: record.latest_shares,
        percentage: record.latest_percentage
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
      
      // Analyze changes using latest available previous data logic (compare each day with latest previous record)
      for (let i = 0; i < activities.length; i++) {
        const currentActivity = activities[i];
        
        // Find the latest record before this date
        let prevRecord = null;
        for (let j = i - 1; j >= 0; j--) {
          if (activities[j].date < currentActivity.date) {
            prevRecord = activities[j];
            break;
          }
        }
        
        if (prevRecord) {
          const change = currentActivity.shares - prevRecord.shares;
          if (change > 0) {
            pattern.buyingDates.push(currentActivity.date);
            pattern.accumulation += change;
          } else if (change < 0) {
            pattern.sellingDates.push(currentActivity.date);
            pattern.reduction += Math.abs(change);
          }
        }
      }
      
      pattern.netChange = activities[activities.length - 1].shares - activities[0].shares;
      
      // Calculate volatility (standard deviation of changes) using latest available previous data logic
      const changes = [];
      for (let i = 0; i < activities.length; i++) {
        const currentActivity = activities[i];
        
        // Find the latest record before this date
        let prevRecord = null;
        for (let j = i - 1; j >= 0; j--) {
          if (activities[j].date < currentActivity.date) {
            prevRecord = activities[j];
            break;
          }
        }
        
        if (prevRecord) {
          changes.push(currentActivity.shares - prevRecord.shares);
        }
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
        const shareholderProfile = shareholderProfiles.get(shareholderId);
        const activityOnDate = shareholderProfile.activities.find(a => a.date === date);
        if (activityOnDate) {
          dateActivityMap.get(date).buyers.push({ 
            id: shareholderId, 
            name: pattern.name,
            accountHolder: shareholderProfile.accountHolder,
            sharesAmount: activityOnDate.shares,
            percentage: activityOnDate.percentage
          });
        }
      });
      
      pattern.sellingDates.forEach(date => {
        if (!dateActivityMap.has(date)) {
          dateActivityMap.set(date, { buyers: [], sellers: [] });
        }
        const shareholderProfile = shareholderProfiles.get(shareholderId);
        const activityOnDate = shareholderProfile.activities.find(a => a.date === date);
        if (activityOnDate) {
          dateActivityMap.get(date).sellers.push({ 
            id: shareholderId, 
            name: pattern.name,
            accountHolder: shareholderProfile.accountHolder,
            sharesAmount: activityOnDate.shares,
            percentage: activityOnDate.percentage
          });
        }
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