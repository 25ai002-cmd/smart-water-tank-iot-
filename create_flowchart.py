import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

def draw_flowchart():
    # Set up figure with crisp resolution and clean aesthetic
    fig, ax = plt.subplots(figsize=(10, 6.2), dpi=300)
    fig.patch.set_facecolor('#FFFFFF')
    ax.set_facecolor('#FFFFFF')
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6.5)
    ax.axis('off')

    # Color Palette (Clean Academic / Engineering Theme)
    c_start = {'fill': '#EEF2FF', 'edge': '#4F46E5', 'text': '#1E1B4B'}   # Indigo
    c_proc  = {'fill': '#F0F9FF', 'edge': '#0284C7', 'text': '#0C4A6E'}   # Sky Blue
    c_dec   = {'fill': '#FFFBEB', 'edge': '#D97706', 'text': '#78350F'}   # Amber
    c_on    = {'fill': '#ECFDF5', 'edge': '#059669', 'text': '#064E3B'}   # Emerald
    c_off   = {'fill': '#FEF2F2', 'edge': '#DC2626', 'text': '#7F1D1D'}   # Rose
    c_no    = {'fill': '#F1F5F9', 'edge': '#475569', 'text': '#1E293B'}   # Slate
    c_stream= {'fill': '#F5F3FF', 'edge': '#7C3AED', 'text': '#4C1D95'}   # Purple

    def add_box(x, y, w, h, text, style, shape='rect', title=None):
        if shape == 'round':
            box = patches.FancyBboxPatch((x - w/2, y - h/2), w, h,
                                         boxstyle="round,pad=0.03,rounding_size=0.15",
                                         facecolor=style['fill'], edgecolor=style['edge'], linewidth=1.8)
        elif shape == 'diamond':
            # Rhombus
            pts = np.array([[x, y + h/2], [x + w/2, y], [x, y - h/2], [x - w/2, y]])
            box = patches.Polygon(pts, facecolor=style['fill'], edgecolor=style['edge'], linewidth=1.8)
        else: # rect
            box = patches.FancyBboxPatch((x - w/2, y - h/2), w, h,
                                         boxstyle="round,pad=0.02,rounding_size=0.06",
                                         facecolor=style['fill'], edgecolor=style['edge'], linewidth=1.8)
        ax.add_patch(box)
        
        if title:
            ax.text(x, y + h/2 - 0.18, title, ha='center', va='center',
                    fontsize=8.5, fontweight='bold', color=style['edge'], fontfamily='sans-serif')
            ax.text(x, y - 0.08, text, ha='center', va='center',
                    fontsize=8, color=style['text'], fontfamily='sans-serif', multialignment='center')
        else:
            ax.text(x, y, text, ha='center', va='center',
                    fontsize=8.5, fontweight='bold' if shape in ['round', 'diamond'] else 'normal',
                    color=style['text'], fontfamily='sans-serif', multialignment='center')

    # --- FLOWCHART NODES ---
    # 0. Start Node
    add_box(5.0, 6.0, 2.6, 0.45, "START LOOP (Every 3s)", c_start, shape='round')

    # 1. Ping Range
    add_box(5.0, 5.15, 3.8, 0.65, "HC-SR04 sends 10µs sound wave pulse\n& measures travel echo time (µs)", c_proc, title="01 | PING RANGE")

    # 2. Calculate Level
    add_box(5.0, 4.15, 3.8, 0.65, "Distance = (EchoTime × 0.0343) / 2\nWater Level (%) = [(Total - Dist) / Height] × 100", c_proc, title="02 | CALCULATE LEVEL")

    # 3. Decision 1: Low Water (<20%)
    add_box(3.2, 3.0, 2.2, 0.85, "Water Level\n< 20% ?", c_dec, shape='diamond')

    # 3. Decision 2: Tank Full (>90%)
    add_box(6.8, 3.0, 2.2, 0.85, "Water Level\n> 90% ?", c_dec, shape='diamond')

    # Action 1: Pump ON
    add_box(1.2, 1.75, 1.8, 0.6, "Turn Pump ON\n(Relay Active)", c_on, title="PUMP CONTROL")

    # Action 2: Maintain State
    add_box(5.0, 1.75, 1.8, 0.6, "Maintain Current\nPump State", c_no, title="NO CHANGE")

    # Action 3: Pump OFF
    add_box(8.8, 1.75, 1.8, 0.6, "Turn Pump OFF\n(Relay Inactive)", c_off, title="PUMP CONTROL")

    # 4. Stream Data
    add_box(5.0, 0.6, 4.4, 0.6, "NodeMCU posts HTTP JSON telemetry packet\nto Backend API & syncs with Dashboard", c_stream, title="04 | STREAM DATA")

    # --- CONNECTORS ---
    # Start -> Step 1
    ax.annotate('', xy=(5.0, 5.485), xytext=(5.0, 5.775),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))

    # Step 1 -> Step 2
    ax.annotate('', xy=(5.0, 4.485), xytext=(5.0, 4.825),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))

    # Step 2 -> Splitter down to Decisions
    ax.plot([5.0, 5.0], [3.825, 3.65], color='#475569', lw=1.6)
    ax.plot([3.2, 6.8], [3.65, 3.65], color='#475569', lw=1.6)
    ax.annotate('', xy=(3.2, 3.435), xytext=(3.2, 3.65),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))
    ax.annotate('', xy=(6.8, 3.435), xytext=(6.8, 3.65),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))

    # Decision 1 -> Pump ON (YES)
    ax.plot([2.1, 1.2], [3.0, 3.0], color='#059669', lw=1.6)
    ax.annotate('', xy=(1.2, 2.06), xytext=(1.2, 3.0),
                arrowprops=dict(arrowstyle="-|>", color='#059669', lw=1.6, mutation_scale=12))
    ax.text(1.65, 3.15, "YES", ha='center', va='center', fontsize=8, fontweight='bold', color='#059669',
            bbox=dict(boxstyle='square,pad=0.15', facecolor='#FFFFFF', edgecolor='none'))

    # Decision 1 -> Maintain (NO)
    ax.plot([3.2, 3.2, 4.09], [2.575, 2.3, 2.3], color='#475569', lw=1.6)
    ax.annotate('', xy=(4.09, 2.3), xytext=(4.0, 2.3),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))
    ax.text(3.45, 2.48, "NO", ha='center', va='center', fontsize=8, fontweight='bold', color='#475569',
            bbox=dict(boxstyle='square,pad=0.15', facecolor='#FFFFFF', edgecolor='none'))

    # Decision 2 -> Pump OFF (YES)
    ax.plot([7.9, 8.8], [3.0, 3.0], color='#DC2626', lw=1.6)
    ax.annotate('', xy=(8.8, 2.06), xytext=(8.8, 3.0),
                arrowprops=dict(arrowstyle="-|>", color='#DC2626', lw=1.6, mutation_scale=12))
    ax.text(8.35, 3.15, "YES", ha='center', va='center', fontsize=8, fontweight='bold', color='#DC2626',
            bbox=dict(boxstyle='square,pad=0.15', facecolor='#FFFFFF', edgecolor='none'))

    # Decision 2 -> Maintain (NO)
    ax.plot([6.8, 6.8, 5.91], [2.575, 2.3, 2.3], color='#475569', lw=1.6)
    ax.annotate('', xy=(5.91, 2.3), xytext=(6.0, 2.3),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))
    ax.text(6.55, 2.48, "NO", ha='center', va='center', fontsize=8, fontweight='bold', color='#475569',
            bbox=dict(boxstyle='square,pad=0.15', facecolor='#FFFFFF', edgecolor='none'))

    # Pump ON, Maintain, Pump OFF -> Stream Data
    ax.plot([1.2, 1.2, 2.79], [1.44, 0.9, 0.9], color='#475569', lw=1.6)
    ax.annotate('', xy=(2.79, 0.9), xytext=(2.7, 0.9),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))

    ax.plot([5.0, 5.0], [1.44, 0.91], color='#475569', lw=1.6)
    ax.annotate('', xy=(5.0, 0.91), xytext=(5.0, 1.0),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))

    ax.plot([8.8, 8.8, 7.21], [1.44, 0.9, 0.9], color='#475569', lw=1.6)
    ax.annotate('', xy=(7.21, 0.9), xytext=(7.3, 0.9),
                arrowprops=dict(arrowstyle="-|>", color='#475569', lw=1.6, mutation_scale=12))

    # Loop back line from Stream Data to Start Loop
    ax.plot([7.21, 9.6, 9.6, 6.31], [0.6, 0.6, 6.0, 6.0], color='#94A3B8', lw=1.4, linestyle='--')
    ax.annotate('', xy=(6.31, 6.0), xytext=(6.4, 6.0),
                arrowprops=dict(arrowstyle="-|>", color='#94A3B8', lw=1.4, mutation_scale=10))
    ax.text(9.6, 3.3, "Loop Every 3s", ha='center', va='center', fontsize=8, color='#64748B', rotation=270,
            bbox=dict(boxstyle='square,pad=0.25', facecolor='#FFFFFF', edgecolor='none'))

    plt.tight_layout()
    plt.savefig('flowchart_slide5.png', dpi=300, bbox_inches='tight')
    plt.close()
    print("Clean flowchart saved to flowchart_slide5.png")

if __name__ == '__main__':
    draw_flowchart()
