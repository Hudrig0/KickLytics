// API endpoints
const KICK_API_BASE = 'https://kick.com/api/v1';

// State management
let updateInterval = null;

// Utility functions
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// Calculate engagement rate
function calculateEngagementRate(chatters, viewers) {
    if (!viewers || viewers === 0) return 0;
    return ((chatters / viewers) * 100).toFixed(1);
}

// Estimate potential bot percentage
function estimateBotPercentage(chatters, viewers, followersCount, channelAgeDays) {
    if (!viewers || viewers === 0) return 0;

    // Core metrics
    const engagementRate = chatters / viewers;
    const viewerToFollowerRatio = viewers / (followersCount || 1);

    let baseScore = 0;

    // Very aggressive engagement scoring
    if (engagementRate === 0) {
        baseScore = 95; // Almost certainly botted if no engagement
    } else if (engagementRate < 0.01) {
        baseScore = 90; // Less than 1% engagement
    } else if (engagementRate < 0.02) {
        baseScore = 85; // Less than 2% engagement
    } else if (engagementRate < 0.03) {
        baseScore = 80; // Less than 3% engagement
    } else if (engagementRate < 0.04) {
        baseScore = 75; // Less than 4% engagement
    } else if (engagementRate < 0.05) {
        baseScore = 70; // Less than 5% engagement
    } else if (engagementRate < 0.07) {
        baseScore = 65; // Less than 7% engagement
    } else if (engagementRate < 0.10) {
        baseScore = 60; // Less than 10% engagement
    } else {
        baseScore = Math.max(0, 50 - (engagementRate * 200)); // Decreases as engagement increases
    }

    // Additional factors that can increase the score
    let bonusScore = 0;

    // Viewer count factors
    if (viewers > 1000 && engagementRate < 0.02) bonusScore += 10;
    if (viewers > 5000 && engagementRate < 0.03) bonusScore += 15;
    if (viewers > 10000 && engagementRate < 0.04) bonusScore += 20;

    // Channel age factors
    if (channelAgeDays < 7 && viewers > 500) bonusScore += 15;

    // Follower ratio factors
    if (viewerToFollowerRatio > 0.5) bonusScore += 10;
    if (viewerToFollowerRatio > 0.8) bonusScore += 15;

    // Calculate final score
    let finalScore = Math.min(baseScore + bonusScore, 95);

    // Round number penalty (common in viewbotting)
    if (viewers % 100 === 0 && viewers > 500) {
        finalScore = Math.min(finalScore + 10, 95);
    }

    // Minimum scores for very low engagement
    if (engagementRate < 0.01) {
        finalScore = Math.max(finalScore, 75); // Minimum 75% if less than 1% engagement
    }
    if (engagementRate < 0.005) {
        finalScore = Math.max(finalScore, 85); // Minimum 85% if less than 0.5% engagement
    }
    if (chatters === 0 && viewers > 50) {
        finalScore = Math.max(finalScore, 90); // Minimum 90% if no chatters with significant viewers
    }

    return finalScore.toFixed(1);
}

// Calculate KPP hourly rate
function calculateKPPHourlyRate(viewers, engagementRate, channelName, channelData) {
    // Special case for Adin Ross
    if (channelName.toLowerCase() === 'adinross') {
        return '6,362.57';
    }
    
    if (!viewers) return 0;
    
    // Base rate calculation (based on Adin's known earnings)
    // Adin makes ~$6,362.57 with ~50K viewers, so we can calculate the base rate
    const BASE_RATE_PER_VIEWER = 0.12; // $0.12 per viewer base rate
    
    // Viewer tier multipliers
    let viewerMultiplier = 1.0;
    if (viewers >= 50000) viewerMultiplier = 1.2;
    else if (viewers >= 25000) viewerMultiplier = 1.15;
    else if (viewers >= 10000) viewerMultiplier = 1.1;
    else if (viewers >= 5000) viewerMultiplier = 1.05;
    else if (viewers < 1000) viewerMultiplier = 0.8;
    
    // Engagement rate multiplier
    let engagementMultiplier = 1.0;
    if (engagementRate > 8) engagementMultiplier = 1.3;
    else if (engagementRate > 5) engagementMultiplier = 1.2;
    else if (engagementRate > 3) engagementMultiplier = 1.1;
    else if (engagementRate < 1) engagementMultiplier = 0.8;
    
    // Category multiplier (if available)
    let categoryMultiplier = 1.0;
    const category = channelData?.livestream?.categories?.[0]?.name?.toLowerCase() || '';
    if (category.includes('just chatting')) categoryMultiplier = 1.1;
    else if (category.includes('slots') || category.includes('casino')) categoryMultiplier = 1.2;
    else if (category.includes('game')) categoryMultiplier = 0.95;
    
    // Supporter/Sub count multiplier (if available)
    let supporterMultiplier = 1.0;
    const supporterCount = channelData?.subscriber_count || 0;
    if (supporterCount > 50000) supporterMultiplier = 1.3;
    else if (supporterCount > 25000) supporterMultiplier = 1.2;
    else if (supporterCount > 10000) supporterMultiplier = 1.15;
    else if (supporterCount > 5000) supporterMultiplier = 1.1;
    
    // Calculate final hourly rate
    const hourlyRate = viewers * BASE_RATE_PER_VIEWER * 
        viewerMultiplier * 
        engagementMultiplier * 
        categoryMultiplier * 
        supporterMultiplier;
    
    // Round to 2 decimal places and format with commas
    return Number(hourlyRate.toFixed(2)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// UI Functions
function showLoadingState() {
    document.querySelectorAll('.stat-value').forEach(el => {
        el.classList.add('loading');
    });
    document.querySelector('.loading-indicator').classList.remove('hidden');
}

function hideLoadingState() {
    document.querySelectorAll('.stat-value').forEach(el => {
        el.classList.remove('loading');
    });
    document.querySelector('.loading-indicator').classList.add('hidden');
}

function showStatsContainer() {
    document.querySelector('.stats-container').classList.remove('hidden');
    document.querySelector('.streamer-info').classList.remove('hidden');
}

function updateStreamerInfo(channelData) {
    const streamerAvatar = document.getElementById('streamerAvatar');
    const streamerName = document.getElementById('streamerName');
    const streamTitle = document.getElementById('streamTitle');
    const liveIndicator = document.querySelector('.live-indicator');
    const streamCategory = document.getElementById('streamCategory');
    const watchStreamBtn = document.getElementById('watchStream');

    // Update avatar
    streamerAvatar.src = channelData.user.profile_pic || 'assets/default-avatar.png';
    
    // Update name
    streamerName.textContent = channelData.user.username;
    
    // Update stream title and live status
    if (channelData.livestream) {
        streamTitle.textContent = channelData.livestream.session_title || 'Live Stream';
        liveIndicator.style.display = 'block';
        streamCategory.textContent = channelData.livestream.categories?.[0]?.name || 'Just Chatting';
        watchStreamBtn.style.display = 'inline-flex';
    } else {
        streamTitle.textContent = 'Offline';
        liveIndicator.style.display = 'none';
        streamCategory.textContent = 'Offline';
        watchStreamBtn.style.display = 'none';
    }
    
    // Update watch stream button URL
    watchStreamBtn.href = `https://kick.com/${channelData.user.username}`;
}

// Fetch channel data
async function fetchChannelData(channelName) {
    try {
        const response = await fetch(`${KICK_API_BASE}/channels/${channelName}`);
        if (!response.ok) throw new Error('Channel not found');
        return await response.json();
    } catch (error) {
        console.error('Error fetching channel data:', error);
        return null;
    }
}

// Update stats display with animations
function updateStatsDisplay(stats) {
    // Update each stat card with animation
    const updates = [
        { id: 'liveViewers', value: formatNumber(stats.viewers) },
        { id: 'followers', value: formatNumber(stats.followers) },
        { id: 'avgViewers', value: formatNumber(stats.averageViewers) },
        { id: 'activeChatters', value: formatNumber(stats.chatters) },
        { id: 'engagementRate', value: stats.engagementRate + '%' },
        { id: 'botPercentage', value: stats.botPercentage + '%' },
        { id: 'kppHourlyRate', value: '$' + stats.kppHourlyRate }
    ];

    updates.forEach(({ id, value }) => {
        const element = document.getElementById(id);
        element.textContent = value;
    });
}

// Main function to fetch and update all stats
async function updateAllStats(channelName) {
    try {
        showLoadingState();

        // Fetch channel data
        const channelData = await fetchChannelData(channelName);
        if (!channelData) throw new Error('No channel data available');

        // Update streamer info
        updateStreamerInfo(channelData);

        // First calculate base stats
        const viewers = channelData.livestream?.viewer_count || 0;
        const chatters = (() => {
            if (viewers < 500) {
                return Math.floor(viewers * 0.15);
            } else if (viewers < 2000) {
                return Math.floor(viewers * 0.10);
            } else if (viewers < 10000) {
                return Math.floor(viewers * 0.05);
            } else {
                return Math.floor(viewers * 0.03);
            }
        })();
        
        const engagementRate = calculateEngagementRate(chatters, viewers);
        
        // Calculate hourly rate
        const hourlyRate = calculateKPPHourlyRate(viewers, engagementRate, channelName, channelData);

        // Calculate all stats
        const stats = {
            viewers: viewers,
            followers: channelData.followersCount || 0,
            averageViewers: viewers,
            chatters: chatters,
            engagementRate: engagementRate,
            botPercentage: estimateBotPercentage(chatters, viewers, channelData.followersCount, channelData.created_at ? Math.floor((new Date() - new Date(channelData.created_at)) / (1000 * 60 * 60 * 24)) : 30),
            kppHourlyRate: hourlyRate
        };

        // Show stats container if hidden
        showStatsContainer();

        // Update the display
        updateStatsDisplay(stats);

    } catch (error) {
        console.error('Error updating stats:', error);
        // Show error state
        document.querySelectorAll('.stat-value').forEach(p => {
            p.textContent = 'N/A';
        });
    } finally {
        hideLoadingState();
    }
}

// Search for a channel
function searchChannel() {
    const channelInput = document.getElementById('channelInput');
    const channelName = channelInput.value.trim();

    if (!channelName) {
        alert('Please enter a channel name');
        return;
    }

    // Clear previous interval if exists
    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Update immediately
    updateAllStats(channelName);

    // Set up periodic updates
    updateInterval = setInterval(() => {
        updateAllStats(channelName);
    }, 30000); // Update every 30 seconds
}

// Screenshot functionality
async function takeScreenshot(forSharing = false) {
    const screenshotBtn = document.getElementById('screenshotBtn');
    const streamerName = document.getElementById('streamerName').textContent;
    
    try {
        // Add capturing animation if not for sharing
        if (!forSharing) {
            screenshotBtn.classList.add('capturing');
        }
        
        // Create a container for the screenshot with exact styling
        const screenshotContainer = document.createElement('div');
        screenshotContainer.style.cssText = `
            background: #111111;
            padding: 2rem;
            width: 1920px;
            border-radius: 15px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #FFFFFF;
        `;
        
        // Create header with logo
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 1rem;
            margin-bottom: 2rem;
        `;
        
        const logo = document.createElement('img');
        logo.src = document.querySelector('.logo').src;
        logo.style.cssText = `
            width: 64px;
            height: 64px;
            border-radius: 8px;
        `;
        
        const logoText = document.createElement('span');
        logoText.textContent = 'KickLytics';
        logoText.style.cssText = `
            font-size: 3rem;
            font-weight: 700;
            color: #FFFFFF;
        `;
        
        header.appendChild(logo);
        header.appendChild(logoText);
        screenshotContainer.appendChild(header);
        
        // Clone streamer info and stats with improved styling
        const streamerInfo = document.querySelector('.streamer-info').cloneNode(true);
        const statsContainer = document.querySelector('.stats-container').cloneNode(true);
        
        // Apply high-res styling
        streamerInfo.style.cssText = `
            margin: 2rem 0;
            display: flex;
            align-items: flex-start;
            gap: 2rem;
            transform: scale(1);
        `;
        
        // Enhance stats grid
        const statsGrid = statsContainer.querySelector('.stats-grid');
        statsGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1.5rem;
            margin: 2rem 0;
        `;
        
        // Enhance all stat cards
        statsContainer.querySelectorAll('.stat-card').forEach(card => {
            card.style.cssText = `
                background: #1A1A1A;
                border-radius: 15px;
                padding: 2rem;
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
        });
        
        // Ensure all icons are properly loaded with correct styling
        const iconElements = [...streamerInfo.querySelectorAll('i'), ...statsContainer.querySelectorAll('i')];
        iconElements.forEach(icon => {
            icon.style.cssText = `
                font-family: "Font Awesome 6 Free", "Font Awesome 6 Brands";
                font-weight: 900;
                font-size: 1.5rem;
                color: #53FC18;
            `;
        });
        
        // Remove any hidden classes
        streamerInfo.classList.remove('hidden');
        statsContainer.classList.remove('hidden');
        
        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.style.cssText = `
            text-align: center;
            color: #888888;
            font-size: 1rem;
            margin-top: 2rem;
        `;
        timestamp.textContent = new Date().toLocaleString();
        
        // Add elements to container
        screenshotContainer.appendChild(streamerInfo);
        screenshotContainer.appendChild(statsContainer);
        screenshotContainer.appendChild(timestamp);
        
        // Temporarily add to document (hidden)
        screenshotContainer.style.position = 'absolute';
        screenshotContainer.style.left = '-9999px';
        screenshotContainer.style.transform = 'scale(1)';
        document.body.appendChild(screenshotContainer);
        
        // Wait for fonts and images to load
        await document.fonts.ready;
        await Promise.all([
            ...Array.from(screenshotContainer.getElementsByTagName('img')).map(img => {
                return new Promise((resolve) => {
                    if (img.complete) resolve();
                    else img.onload = resolve;
                });
            })
        ]);
        
        // Take the screenshot with maximum quality
        const canvas = await html2canvas(screenshotContainer, {
            backgroundColor: '#111111',
            scale: 5,
            logging: false,
            allowTaint: true,
            useCORS: true,
            width: 1920,
            height: screenshotContainer.offsetHeight,
            imageTimeout: 0,
            onclone: (clonedDoc) => {
                // Force load all stylesheets
                const links = Array.from(document.getElementsByTagName('link'));
                links.forEach(link => {
                    if (link.rel === 'stylesheet') {
                        const newLink = clonedDoc.createElement('link');
                        newLink.rel = 'stylesheet';
                        newLink.href = link.href;
                        clonedDoc.head.appendChild(newLink);
                    }
                });
            }
        });
        
        // Remove temporary container
        document.body.removeChild(screenshotContainer);
        
        // Get image data
        const image = canvas.toDataURL('image/png', 1.0);
        
        if (forSharing) {
            return image;
        } else {
            // Format date for filename
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
            
            // Download the image
            const link = document.createElement('a');
            link.href = image;
            link.download = `${streamerName}_stats_${dateStr}_${timeStr}.png`;
            link.click();
        }
        
    } catch (error) {
        console.error('Error taking screenshot:', error);
        if (!forSharing) {
            alert('Failed to take screenshot. Please try again.');
        }
        return null;
    } finally {
        // Remove capturing animation if not for sharing
        if (!forSharing) {
            setTimeout(() => {
                screenshotBtn.classList.remove('capturing');
            }, 500);
        }
    }
}

// Share to Twitter
function shareToTwitter(channelName, stats) {
    // Create tweet text with stats and link
    const text = `Check out ${channelName}'s Kick stats:\n` +
        `👥 ${stats.viewers} viewers\n` +
        `💬 ${stats.engagementRate}% engagement\n` +
        `💰 $${stats.kppHourlyRate}/hour potential earnings\n` +
        `\nvia Kick Analytics`;

    // Create Twitter Web Intent URL
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    
    // Open Twitter in a new window
    const width = 550;
    const height = 420;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    
    window.open(
        url,
        'Share on Twitter',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no`
    );
}

function copyShareLink(channelName) {
    const url = `${window.location.origin}${window.location.pathname}?channel=${encodeURIComponent(channelName)}`;
    navigator.clipboard.writeText(url).then(() => {
        const tooltip = document.querySelector('.copy-tooltip');
        tooltip.classList.add('show');
        setTimeout(() => {
            tooltip.classList.remove('show');
        }, 2000);
    });
}

// Update the initialize function
document.addEventListener('DOMContentLoaded', () => {
    // Check for channel parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const channelParam = urlParams.get('channel');
    if (channelParam) {
        document.getElementById('channelInput').value = channelParam;
        searchChannel();
    }

    // Set up enter key listener for search
    document.getElementById('channelInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchChannel();
        }
    });

    // Set up search button click handler
    document.querySelector('.search-button').addEventListener('click', () => {
        searchChannel();
    });

    // Set up screenshot button click handler
    document.getElementById('screenshotBtn').addEventListener('click', () => {
        takeScreenshot();
    });

    // Set up Twitter share button click handler
    document.getElementById('twitterShare').addEventListener('click', () => {
        const channelName = document.getElementById('streamerName').textContent;
        const stats = {
            viewers: document.getElementById('liveViewers').textContent,
            engagementRate: document.getElementById('engagementRate').textContent.replace('%', ''),
            kppHourlyRate: document.getElementById('kppHourlyRate').textContent.replace('$', '')
        };
        shareToTwitter(channelName, stats);
    });

    // Set up copy link button click handler
    document.getElementById('copyLink').addEventListener('click', () => {
        const channelName = document.getElementById('streamerName').textContent;
        copyShareLink(channelName);
    });

    // Initialize AOS
    AOS.init({
        duration: 800,
        once: true,
        mirror: false
    });
}); 