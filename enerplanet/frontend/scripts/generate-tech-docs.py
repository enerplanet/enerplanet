#!/usr/bin/env python3
"""
Generate professional PDF documentation for EnerPlanET Technologies - How to Create Guide
"""

import json
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, ListFlowable, ListItem
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from datetime import datetime

# Load tech descriptions
with open('../initial-data/techs/tech_description_data.json', 'r') as f:
    desc_data = json.load(f)

# Create PDF document
doc = SimpleDocTemplate(
    "public/docs/technology-reference-guide.pdf",
    pagesize=A4,
    rightMargin=1.5*cm,
    leftMargin=1.5*cm,
    topMargin=2*cm,
    bottomMargin=2*cm
)

# Styles
styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Heading1'],
    fontSize=24,
    spaceAfter=30,
    alignment=TA_CENTER,
    textColor=colors.HexColor('#1a1a2e')
)

subtitle_style = ParagraphStyle(
    'CustomSubtitle',
    parent=styles['Normal'],
    fontSize=12,
    spaceAfter=20,
    alignment=TA_CENTER,
    textColor=colors.HexColor('#666666')
)

section_title_style = ParagraphStyle(
    'SectionTitle',
    parent=styles['Heading2'],
    fontSize=16,
    spaceBefore=20,
    spaceAfter=12,
    textColor=colors.HexColor('#2563eb')
)

subsection_style = ParagraphStyle(
    'SubSection',
    parent=styles['Heading3'],
    fontSize=12,
    spaceBefore=15,
    spaceAfter=8,
    textColor=colors.HexColor('#1f2937')
)

body_style = ParagraphStyle(
    'CustomBody',
    parent=styles['Normal'],
    fontSize=10,
    spaceAfter=8,
    alignment=TA_JUSTIFY,
    textColor=colors.HexColor('#374151')
)

small_style = ParagraphStyle(
    'SmallText',
    parent=styles['Normal'],
    fontSize=8,
    textColor=colors.HexColor('#6b7280')
)

code_style = ParagraphStyle(
    'CodeStyle',
    parent=styles['Normal'],
    fontSize=9,
    fontName='Courier',
    textColor=colors.HexColor('#6366f1'),
    backColor=colors.HexColor('#f3f4f6'),
    leftIndent=10,
    rightIndent=10,
    spaceBefore=5,
    spaceAfter=5
)

# Build document elements
elements = []

# Title Page
elements.append(Spacer(1, 2*inch))
elements.append(Paragraph("EnerPlanET", title_style))
elements.append(Paragraph("Technology Creation Guide", ParagraphStyle(
    'SubTitle',
    parent=title_style,
    fontSize=18,
    textColor=colors.HexColor('#3b82f6')
)))
elements.append(Spacer(1, 0.5*inch))
elements.append(Paragraph("How to Create and Configure Energy Technologies", subtitle_style))
elements.append(Spacer(1, 1*inch))
elements.append(Paragraph(f"Version 1.0 | {datetime.now().strftime('%B %Y')}", small_style))
elements.append(Paragraph("© 2024 SpatialHub. All rights reserved.", small_style))
elements.append(PageBreak())

# Introduction
elements.append(Paragraph("Introduction", section_title_style))
elements.append(Paragraph(
    """This guide explains how to create custom energy technologies in the EnerPlanET simulation platform. 
    Technologies represent different energy sources, storage systems, and consumption profiles that can be 
    used in your energy simulations.""",
    body_style
))
elements.append(Spacer(1, 0.2*inch))

# Technology Structure
elements.append(Paragraph("Technology Structure", section_title_style))
elements.append(Paragraph(
    """Each technology consists of two main components:""",
    body_style
))
elements.append(Spacer(1, 0.1*inch))

elements.append(Paragraph("<b>1. Basic Information</b>", body_style))
tech_fields = [
    ("<b>Key:</b>", "Unique identifier (e.g., 'pv_supply', 'battery_storage')"),
    ("<b>Alias:</b>", "Human-readable display name"),
    ("<b>Icon:</b>", "Visual icon identifier (battery, sun, wind, leaf, flame, droplets, home, building-2)"),
    ("<b>Description:</b>", "Brief explanation of the technology"),
]
for field, desc in tech_fields:
    elements.append(Paragraph(f"• {field} {desc}", body_style))

elements.append(Spacer(1, 0.15*inch))
elements.append(Paragraph("<b>2. Parameters (Constraints)</b>", body_style))
elements.append(Paragraph(
    """Parameters define the configurable values for each technology. Each parameter has:""",
    body_style
))
param_fields = [
    ("<b>Key:</b>", "Unique parameter identifier (e.g., 'cont_energy_cap_max')"),
    ("<b>Alias:</b>", "Display name for the parameter"),
    ("<b>Description:</b>", "Detailed explanation of what the parameter controls"),
    ("<b>Default Value:</b>", "Initial value for the parameter"),
    ("<b>Unit:</b>", "Measurement unit (kW, %, years, EUR/kW, etc.)"),
    ("<b>Min/Max:</b>", "Valid range for the parameter (optional)"),
]
for field, desc in param_fields:
    elements.append(Paragraph(f"• {field} {desc}", body_style))

elements.append(PageBreak())

# Parameter Naming Convention
elements.append(Paragraph("Parameter Naming Convention", section_title_style))
elements.append(Paragraph(
    """Parameters follow a consistent naming convention to help organize and identify their purpose:""",
    body_style
))
elements.append(Spacer(1, 0.1*inch))

naming_conventions = [
    ("cont_*", "Continuous/Technical", "Physical and operational constraints like capacity, efficiency, lifetime"),
    ("cost_*", "Cost Parameters", "Financial costs including investment, O&M, and interest rates"),
    ("monetary_*", "Financial", "Economic parameters like depreciation and discount rates"),
]

conv_data = [["Prefix", "Category", "Description"]]
for prefix, category, desc in naming_conventions:
    conv_data.append([prefix, category, desc])

conv_table = Table(conv_data, colWidths=[1.2*inch, 1.5*inch, 3.3*inch])
conv_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1f2937')),
    ('TEXTCOLOR', (0, 1), (0, -1), colors.HexColor('#6366f1')),
    ('FONTNAME', (0, 1), (0, -1), 'Courier'),
    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
]))
elements.append(conv_table)

elements.append(PageBreak())

# Available Parameters Reference
elements.append(Paragraph("Available Parameters Reference", section_title_style))
elements.append(Paragraph(
    """Below is the complete list of standard parameters you can use when creating technologies. 
    Match your parameter's Alias with the Name below to get automatic descriptions.""",
    body_style
))
elements.append(Spacer(1, 0.2*inch))

# Create table from tech descriptions
param_data = [["Parameter Name", "Unit", "Description"]]
for item in desc_data.get('techs', []):
    name = item.get('Name', '')[:40]
    if len(item.get('Name', '')) > 40:
        name += '...'
    unit = item.get('Unit', '—') or '—'
    desc = item.get('Description', '')[:60]
    if len(item.get('Description', '')) > 60:
        desc += '...'
    param_data.append([name, unit, desc])

param_table = Table(param_data, colWidths=[2.2*inch, 0.8*inch, 3*inch])
param_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, 0), 8),
    ('FONTSIZE', (0, 1), (-1, -1), 7),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1f2937')),
    ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#374151')),
    ('ALIGN', (1, 0), (1, -1), 'CENTER'),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
    *[('BACKGROUND', (0, i), (-1, i), colors.HexColor('#f9fafb')) for i in range(2, len(param_data), 2)]
]))
elements.append(param_table)

elements.append(PageBreak())

# How to Add a Technology
elements.append(Paragraph("How to Add a Technology", section_title_style))
elements.append(Paragraph(
    """Follow these steps to create a new technology in the platform:""",
    body_style
))
elements.append(Spacer(1, 0.1*inch))

steps = [
    ("Navigate to Technologies Page", "Go to the Technologies section in the sidebar."),
    ("Click 'Add Technology'", "Click the 'Add Technology' button in the top-right corner."),
    ("Fill Basic Information", "Enter the Key (unique identifier), Display Name, Description, and select an Icon."),
    ("Add Parameters", "Click 'Add Parameter' to add configurable constraints. Use standard parameter names from this guide to get automatic descriptions."),
    ("Save", "Click 'Add Technology' to save your new technology."),
]

for i, (title, desc) in enumerate(steps, 1):
    elements.append(Paragraph(f"<b>Step {i}: {title}</b>", body_style))
    elements.append(Paragraph(desc, small_style))
    elements.append(Spacer(1, 0.1*inch))

elements.append(Spacer(1, 0.2*inch))

# How to Add Parameters to Existing Technologies
elements.append(Paragraph("Adding Parameters to Existing Technologies", section_title_style))
elements.append(Paragraph(
    """You can add new parameters to technologies you have created:""",
    body_style
))
elements.append(Spacer(1, 0.1*inch))

add_param_steps = [
    "Click the 'View' (eye icon) button on your technology card",
    "In the parameters section, click 'Add Parameter'",
    "Fill in the Key, Alias, Description, Default Value, Unit, and Range",
    "Click 'Add Parameter' to save",
]

for step in add_param_steps:
    elements.append(Paragraph(f"• {step}", body_style))

elements.append(Spacer(1, 0.2*inch))
elements.append(Paragraph(
    "<b>Note:</b> You can only add parameters to technologies you have created. System default technologies cannot be modified.",
    small_style
))

elements.append(PageBreak())

# Technology Types Reference
elements.append(Paragraph("Common Technology Types", section_title_style))
elements.append(Paragraph(
    """Here are the standard technology types used in energy simulations:""",
    body_style
))
elements.append(Spacer(1, 0.1*inch))

tech_types = [
    ("Supply Technologies", [
        ("pv_supply", "Photovoltaic (Solar) Supply", "Solar energy generation systems"),
        ("wind_onshore", "Wind Turbine Supply", "Onshore wind energy generation"),
        ("biomass_supply", "Biomass Supply", "Biomass power generation"),
        ("geothermal_supply", "Geothermal Supply", "Geothermal energy systems"),
        ("water_supply", "Hydropower Supply", "Hydropower generation"),
    ]),
    ("Storage Technologies", [
        ("battery_storage", "Battery Storage", "Energy storage using batteries"),
    ]),
    ("Demand Technologies", [
        ("households_supply", "Households", "Residential energy consumption"),
        ("non_households_supply", "Non-Households", "Commercial/industrial consumption"),
    ]),
]

for category, techs in tech_types:
    elements.append(Paragraph(f"<b>{category}</b>", subsection_style))
    for key, name, desc in techs:
        elements.append(Paragraph(f"• <b>{name}</b> (<font color='#6366f1'>{key}</font>): {desc}", body_style))
    elements.append(Spacer(1, 0.1*inch))

# Footer
elements.append(Spacer(1, 0.5*inch))
elements.append(Paragraph(
    f"<i>Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | EnerPlanET v1.0</i>",
    ParagraphStyle('Footer', parent=small_style, alignment=TA_CENTER)
))

# Build PDF
doc.build(elements)
print("PDF generated successfully: public/docs/technology-reference-guide.pdf")
