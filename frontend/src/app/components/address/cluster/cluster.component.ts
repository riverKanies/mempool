import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, HostListener } from '@angular/core';
import { Transaction } from '@interfaces/electrs.interface';

@Component({
  selector: 'app-address-cluster',
  templateUrl: './cluster.component.html',
  styleUrls: ['./cluster.component.scss']
})
export class ClusterComponent implements OnChanges, AfterViewInit {
  @Input() transactions: Transaction[];
  @Input() addressString: string;
  @ViewChild('clusterSvg') clusterSvg: ElementRef<SVGSVGElement>;
  @ViewChild('svgContainer') svgContainer: ElementRef;
  
  firstTransaction: Transaction | null = null;
  isLoading = true;
  
  // SVG zoom and pan properties
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  
  // Computed transform property for SVG
  get transform(): string {
    return `translate(${this.translateX}, ${this.translateY}) scale(${this.scale})`;
  }
  
  // View box for SVG
  get viewBox(): string {
    return '0 0 300 200';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.transactions && this.transactions?.length) {
      this.isLoading = false;
      this.firstTransaction = this.transactions[0];
    }
  }
  
  ngAfterViewInit() {
    this.initializeZoom();
  }
  
  private initializeZoom() {
    if (this.svgContainer) {
      const element = this.svgContainer.nativeElement;
      
      // Mouse wheel zoom
      element.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault();
        
        // Calculate mouse position relative to the SVG container
        const rect = element.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const zoomFactor = 1 - Math.sign(event.deltaY) * 0.01; // Adjusted for smoother zooming
        const newScale = Math.max(0.5, Math.min(this.scale * zoomFactor, 5));
        
        // Calculate the mouse position in SVG coordinates before zoom
        const svgPointBefore = {
          x: (mouseX - this.translateX) / this.scale,
          y: (mouseY - this.translateY) / this.scale
        };

        // Update scale
        this.scale = newScale;

        // Adjust translation to keep the point under the mouse fixed
        this.translateX = mouseX - svgPointBefore.x * this.scale;
        this.translateY = mouseY - svgPointBefore.y * this.scale;
      }, { passive: false });
      
      // Mouse drag for panning
      element.addEventListener('mousedown', (event: MouseEvent) => {
        this.isDragging = true;
        this.startX = event.clientX - this.translateX;
        this.startY = event.clientY - this.translateY;
        element.style.cursor = 'grabbing';
      });
      
      element.addEventListener('mousemove', (event: MouseEvent) => {
        const rect = element.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const mousePointX = (mouseX - this.translateX) / this.scale;
        const mousePointY = (mouseY - this.translateY) / this.scale;
        console.log('mousemove', mousePointX, mousePointY);
        if (this.isDragging) {
          this.translateX = event.clientX - this.startX;
          this.translateY = event.clientY - this.startY;
        }
      });
      
      // End dragging
      const endDrag = () => {
        this.isDragging = false;
        element.style.cursor = 'grab';
      };
      
      element.addEventListener('mouseup', endDrag);
      element.addEventListener('mouseleave', endDrag);
      
      // Set initial cursor
      element.style.cursor = 'grab';
    }
  }
} 