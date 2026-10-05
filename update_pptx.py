import pptx
from pptx.util import Inches, Pt

def update_presentation():
    pptx_path = 'AquaMonitor_Presentation_Final_v3.pptx'
    prs = pptx.Presentation(pptx_path)
    
    # Target Slide 5 (index 4)
    slide = prs.slides[4]
    
    # Get shape 5 (Rounded Rectangle placeholder)
    # Shape 5 left=6217920 (6.79 in), top=1645920 (1.80 in), width=5212080 (5.70 in), height=3291840 (3.60 in)
    placeholder_shape = slide.shapes[5]
    left = placeholder_shape.left
    top = placeholder_shape.top
    width = placeholder_shape.width
    height = placeholder_shape.height
    
    # Remove the placeholder shape from the slide
    sp = placeholder_shape._element
    sp.getparent().remove(sp)
    
    # Insert the new clean flowchart image at the exact position
    image_path = 'flowchart_slide5.png'
    new_pic = slide.shapes.add_picture(image_path, left, top, width, height)
    
    # Update caption (Shape 6)
    if len(slide.shapes) > 5:
        caption_shape = slide.shapes[5] # now index 5 after removing shape 5
        if caption_shape.has_text_frame:
            caption_shape.text_frame.text = "Figure: Operational flow logic & automated pump relay trigger loop (3s interval)."
            for p in caption_shape.text_frame.paragraphs:
                p.font.size = Pt(11)
                p.font.italic = True
                p.font.name = 'Inter'

    # Save presentation
    prs.save(pptx_path)
    print(f"Successfully updated Slide 5 in {pptx_path}")

if __name__ == '__main__':
    update_presentation()
