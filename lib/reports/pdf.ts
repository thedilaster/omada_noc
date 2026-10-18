import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReportSummaryData } from '@/types/reports';
import { formatUptime } from '@/lib/omada/formatters';

interface AutoTableDoc extends jsPDF {
  lastAutoTable: {
    finalY: number;
  };
}

/**
 * Generates an executive-ready vector PDF report from aggregated telemetry and security data.
 */
export function generateNocPdfReport(data: ReportSummaryData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // 1. Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Title
  doc.setTextColor(6, 182, 212); // cyan-500
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('OMADA.NOC', margin, 12);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Executive Network Operations & Telemetry Dossier', margin, 19);

  // Date and Site
  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(9);
  const dateStr = new Date(data.generatedAt).toLocaleString();
  doc.text(`Generated: ${dateStr}`, pageWidth - margin, 12, { align: 'right' });
  doc.text(`Site: ${data.siteName} | Controller Uptime: ${data.controllerUptime}`, pageWidth - margin, 19, {
    align: 'right',
  });

  let currentY = 36;

  // 2. Executive KPI Cards Banner
  doc.setFillColor(241, 245, 249); // slate-100
  doc.roundedRect(margin, currentY, pageWidth - margin * 2, 22, 2, 2, 'F');

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('HEALTH SCORE', margin + 6, currentY + 6);
  doc.text('TOTAL CLIENTS', margin + 45, currentY + 6);
  doc.text('MANAGED NODES', margin + 85, currentY + 6);
  doc.text('LIVE THROUGHPUT', margin + 125, currentY + 6);
  doc.text('SESSION VOLUME', margin + 160, currentY + 6);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  // Health score color
  if (data.networkHealthScore >= 90) {
    doc.setTextColor(16, 185, 129); // green
  } else if (data.networkHealthScore >= 75) {
    doc.setTextColor(245, 158, 11); // amber
  } else {
    doc.setTextColor(239, 68, 68); // rose
  }
  doc.text(`${data.networkHealthScore}/100`, margin + 6, currentY + 16);

  doc.setTextColor(15, 23, 42);
  doc.text(
    `${data.infrastructure.totalClients} (${data.infrastructure.wirelessClients} Wi-Fi / ${data.infrastructure.wiredClients} Wire)`,
    margin + 45,
    currentY + 16
  );
  doc.text(
    `${data.infrastructure.totalAps + data.infrastructure.totalSwitches + data.infrastructure.totalGateways} (${data.infrastructure.totalAps} AP, ${data.infrastructure.totalSwitches} Sw, ${data.infrastructure.totalGateways} GW)`,
    margin + 85,
    currentY + 16
  );
  doc.text(`${data.infrastructure.aggregateThroughputMbps} Mbps`, margin + 125, currentY + 16);
  doc.text(`${data.infrastructure.totalSessionTrafficGb} GB`, margin + 160, currentY + 16);

  currentY += 26;

  // Optional AI Comparative Narration Box
  if (data.narration) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, currentY, pageWidth - margin * 2, 20, 1.5, 1.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(88, 28, 135); // purple-900
    doc.text('AI COMPARATIVE DIAGNOSTIC NARRATION:', margin + 4, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const splitNarrative = doc.splitTextToSize(
      `Baseline: ${data.narration.historyContext.slice(0, 140)}... | Delta: ${data.narration.deltaChanges.slice(0, 140)}...`,
      pageWidth - margin * 2 - 8
    );
    doc.text(splitNarrative, margin + 4, currentY + 10);
    currentY += 24;
  }

  // 3. Section: Top 5 Real-Time Active Devices
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('1. Top 5 Real-Time Active Devices (Instantaneous Rate)', margin, currentY);
  currentY += 4;

  const activeDeviceRows = data.topActiveDevices.map((d, index) => [
    `#${index + 1} ${d.name}`,
    d.ip,
    d.mac,
    d.medium,
    d.ssidOrPort,
    `${d.currentRateMbps} Mbps`,
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [['Device Name', 'IP Address', 'MAC Address', 'Medium', 'SSID / Port', 'Live Rate']],
    body: activeDeviceRows.length > 0 ? activeDeviceRows : [['No active devices reporting traffic', '-', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });

  currentY = (doc as AutoTableDoc).lastAutoTable.finalY + 8;

  // 4. Section: Top 5 Heaviest Bandwidth Consumers (Volume)
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('2. Top 5 Cumulative Bandwidth Consumers (Session Volume)', margin, currentY);
  currentY += 4;

  const volumeDeviceRows = data.topVolumeDevices.map((d, index) => [
    `#${index + 1} ${d.name}`,
    d.ip,
    d.mac,
    d.medium,
    `${d.downloadTrafficMb} MB`,
    `${d.uploadTrafficMb} MB`,
    `${d.totalTrafficMb} MB`,
    formatUptime(d.uptimeSeconds),
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [['Device Name', 'IP Address', 'MAC Address', 'Medium', 'Download', 'Upload', 'Total Volume', 'Uptime']],
    body: volumeDeviceRows.length > 0 ? volumeDeviceRows : [['No devices reporting cumulative volume', '-', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });

  currentY = (doc as AutoTableDoc).lastAutoTable.finalY + 8;

  // Check if we need to add a page or continue
  if (currentY > pageHeight - 60) {
    doc.addPage();
    currentY = 20;
  }

  // 5. Section: Wireless RF Health & Spectrum Distribution
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('3. Wireless RF Signal & Coverage Distribution', margin, currentY);
  currentY += 4;

  const rfTotal = data.rfDistribution.totalWireless || 1;
  const rfRows = [
    [
      'Excellent (> -60 dBm)',
      `${data.rfDistribution.excellent} clients`,
      `${Math.round((data.rfDistribution.excellent / rfTotal) * 100)}%`,
      'Optimal PHY rates, lowest latency',
    ],
    [
      'Good (-60 to -70 dBm)',
      `${data.rfDistribution.good} clients`,
      `${Math.round((data.rfDistribution.good / rfTotal) * 100)}%`,
      'Strong reliable wireless link',
    ],
    [
      'Fair (-70 to -80 dBm)',
      `${data.rfDistribution.fair} clients`,
      `${Math.round((data.rfDistribution.fair / rfTotal) * 100)}%`,
      'Sub-optimal; candidate for roaming',
    ],
    [
      'Poor (< -80 dBm)',
      `${data.rfDistribution.poor} clients`,
      `${Math.round((data.rfDistribution.poor / rfTotal) * 100)}%`,
      'Weak signal; high packet retry risk',
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    head: [['Signal Strength Tier', 'Device Count', 'Spectrum %', 'Operational Impact']],
    body: rfRows,
    theme: 'grid',
    headStyles: { fillColor: [8, 145, 178], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });

  currentY = (doc as AutoTableDoc).lastAutoTable.finalY + 8;

  // 6. Section: Top Active System Operators & Security Summary (admin reports only)
  if (data.securitySummary) {
    if (currentY > pageHeight - 50) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('4. Multi-Tenant Scoping & Security Summary', margin, currentY);
    currentY += 4;

    const userRows = data.topActiveUsers.map((u) => [
      u.fullName || u.username,
      u.email,
      u.role,
      `${u.taggedDevicesCount} device(s)`,
      new Date(u.lastActiveDate).toLocaleDateString(),
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [['User / Operator', 'Email Address', 'Role', 'Tagged Hardware', 'Last Active']],
      body: userRows.length > 0 ? userRows : [['No user accounts registered', '-', '-', '-', '-']],
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
    });
  }

  // Footer on all pages (a non-cryptographic identifier for this export)
  const reportId = Date.now().toString(16).toUpperCase();
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `OMADA.NOC Confidential Executive Report • Page ${i} of ${totalPages} • Report ID: ${reportId}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  return doc;
}
