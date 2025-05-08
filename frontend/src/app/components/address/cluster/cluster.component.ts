import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, HostListener } from '@angular/core';
import { Transaction } from '@interfaces/electrs.interface';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { forkJoin } from 'rxjs';
// known satoshi address: http://localhost:4200/address/0411db93e1dcdb8a016b49840f8c53bc1eb68a382e97b1482ecad7b148a6909a5cb2e0eaddfb84ccf9744464f82e160bfa9b8b64f9d4c03f999b8643f656b412a3
// multiple inputs: http://localhost:4200/address/04ea1feff861b51fe3f5f8a3b12d0f4712db80e919548a80839fc47c6a21e66d957e9c5d8cd108c7a2d2324bad71f9904ac0ae7336507d785b17a2c115e427a32f

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
  
  // Component's internal transaction state
  private displayedTransactions: Transaction[] = [];
  
  // SVG zoom and pan properties
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  
  // Visualization properties
  private nodeRadius = 20;
  private horizontalSpacing = 100;
  private verticalSpacing = 80;
  private svgWidth = 0;
  private svgHeight = 0;
  
  // At the class level
  private readonly clusterNodeStyles = {
    fill: '#4caf50',
    fillHover: '#81c784',
    stroke: '#2e7d32',
    strokeWidth: '2px'
  };

  private readonly externalNodeStyles = {
    fill: '#2196f3',
    fillHover: '#64b5f6',
    stroke: '#0d47a1',
    strokeWidth: '2px'
  };

  private readonly linkStyles = {
    stroke: '#fff',
    strokeWidth: '2'
  };
  
  // Computed transform property for SVG
  get transform(): string {
    return `translate(${this.translateX}, ${this.translateY}) scale(${this.scale})`;
  }
  
  // View box for SVG
  get viewBox(): string {
    return `0 0 ${this.svgWidth || 800} ${this.svgHeight || 300}`;
  }

  constructor(
    private electrsApiService: ElectrsApiService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.transactions && this.transactions?.length) {
      this.isLoading = false;
      this.firstTransaction = this.transactions[this.transactions.length - 1]; // Get the oldest transaction
      
      // Initialize the displayed transactions with just the first/oldest transaction
      this.displayedTransactions = [this.firstTransaction];
      
      // After data is loaded, render the visualization
      setTimeout(() => this.renderTransactionFlow(), 0);
    }
  }
  
  ngAfterViewInit() {
    this.initializeZoom();
    if (this.transactions?.length) {
      this.renderTransactionFlow();
    }
  }
  
  private renderTransactionFlow() {
    if (!this.clusterSvg || !this.displayedTransactions.length) return;
    
    const svg = this.clusterSvg.nativeElement;
    const g = svg.querySelector('g');
    
    // Clear previous content
    while (g.firstChild) {
      g.removeChild(g.firstChild);
    }
    
    // Use the component's internal transaction list instead of the input transactions
    const orderedTransactions = [...this.displayedTransactions];
    
    // Calculate SVG dimensions based on transaction count
    this.svgWidth = Math.max(800, orderedTransactions.length * this.horizontalSpacing + 100);
    this.svgHeight = 300;
    
    // Create nodes and connections
    orderedTransactions.forEach((tx, index) => {
      const x = 50 + index * this.horizontalSpacing;
      const y = 80;
      
      // Create node for the address we're focusing on
      this.createNode(g, x, y, tx.txid, 'address', this.addressString);
      
      // create connection from previous
      this.createHorizontalArrow(g, x - this.horizontalSpacing, y, x, y);
      
      // For all except coinbase, create external payment node
      if (index > 0 || !this.isCoinbase(tx)) {
        const externalY = y + this.verticalSpacing;
        // Find an external address (one that's not the current address)
        const externalAddress = this.findExternalAddress(tx);
        this.createNode(g, x, externalY, tx.txid, 'external', externalAddress);
        
        // Create S-shaped connection to external payment
        this.createSCurve(g, x - this.horizontalSpacing, y, x, externalY);
      }
    });
  }
  
  private findExternalAddress(tx: Transaction): string {
    // For outputs: find addresses that received from our address
    for (const output of tx.vout) {
      // First try to use the scriptpubkey_address if available
      if (output.scriptpubkey_address && 
          output.scriptpubkey_address !== this.addressString) {
        return output.scriptpubkey_address;
      }
      // If no scriptpubkey_address, use the scriptpubkey as a fallback for P2PK
      else if (output.scriptpubkey && 
               !output.scriptpubkey_address && 
               output.scriptpubkey_type === 'p2pk') {
        return `...${output.scriptpubkey.substring(output.scriptpubkey.length - 5)}`;
      }
    }
    
    // For inputs: find addresses that sent to our address
    for (const input of tx.vin) {
      // Try to use the prevout's scriptpubkey_address if available
      if (input.prevout?.scriptpubkey_address && 
          input.prevout.scriptpubkey_address !== this.addressString) {
        return input.prevout.scriptpubkey_address;
      }
      // If no scriptpubkey_address in prevout, use scriptpubkey as fallback
      else if (input.prevout?.scriptpubkey && 
               !input.prevout.scriptpubkey_address && 
               input.prevout.scriptpubkey_type === 'p2pk') {
        return `...${input.prevout.scriptpubkey.substring(input.prevout.scriptpubkey.length - 5)}`;
      }
    }
    
    // If still no external address or scriptpubkey found, check for other script types
    for (const output of tx.vout) {
      if (output.scriptpubkey && output.scriptpubkey !== '' && 
          (!output.scriptpubkey_address || output.scriptpubkey_address !== this.addressString)) {
        const scriptType = output.scriptpubkey_type || 'unknown';
        return `${scriptType}: ...${output.scriptpubkey.substring(output.scriptpubkey.length - 5)}`;
      }
    }
    
    // Last resort fallback
    return 'Unknown Address';
  }
  
  private createNode(parent: SVGElement, x: number, y: number, txid: string, type: 'address' | 'external' = 'address', address: string = 'Unknown') {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x.toString());
    circle.setAttribute('cy', y.toString());
    circle.setAttribute('r', this.nodeRadius.toString());
    
    // Apply styles directly to the element
    if (type === 'address') {
      circle.setAttribute('class', 'cluster-node');
      circle.setAttribute('fill', this.clusterNodeStyles.fill);
      circle.setAttribute('stroke', this.clusterNodeStyles.stroke);
      circle.setAttribute('stroke-width', this.clusterNodeStyles.strokeWidth);
      circle.setAttribute('cursor', 'pointer');
      // Add hover effect with JavaScript since we can't use CSS :hover
      circle.addEventListener('mouseenter', () => {
        circle.setAttribute('fill', this.clusterNodeStyles.fillHover);
      });
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('fill', this.clusterNodeStyles.fill);
      });
    } else {
      circle.setAttribute('class', 'external-node');
      circle.setAttribute('fill', this.externalNodeStyles.fill);
      circle.setAttribute('stroke', this.externalNodeStyles.stroke);
      circle.setAttribute('stroke-width', this.externalNodeStyles.strokeWidth);
      circle.setAttribute('cursor', 'pointer');
      // Add hover effect with JavaScript
      circle.addEventListener('mouseenter', () => {
        circle.setAttribute('fill', this.externalNodeStyles.fillHover);
      });
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('fill', this.externalNodeStyles.fill);
      });
    }
    
    circle.setAttribute('data-txid', txid);
    
    // Update click event to fetch next transaction instead of navigating
    circle.addEventListener('click', () => {
      this.fetchNextTransaction(txid, address);
    });
    
    parent.appendChild(circle);
    
    // Add tooltip with truncated address
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x.toString());
    text.setAttribute('y', (y + this.nodeRadius + 15).toString());
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'node-label');
    text.setAttribute('fill', '#fff');
    text.setAttribute('font-size', '12px');
    text.setAttribute('user-select', 'none');
    
    // Display truncated address instead of txid
    const displayText = address ? 
      (address.length > 10 ? `...${address.substring(address.length - 5)}` : address) : 
      'Unknown';
    text.textContent = displayText;
    
    parent.appendChild(text);
  }
  
  private createHorizontalArrow(parent: SVGElement, x1: number, y1: number, x2: number, y2: number) {
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    arrow.setAttribute('x1', (x1 + this.nodeRadius).toString());
    arrow.setAttribute('y1', y1.toString());
    arrow.setAttribute('x2', (x2 - this.nodeRadius).toString());
    arrow.setAttribute('y2', y2.toString());
    arrow.setAttribute('stroke', this.linkStyles.stroke);
    arrow.setAttribute('stroke-width', this.linkStyles.strokeWidth);
    arrow.setAttribute('marker-end', 'url(#arrowhead)');
    arrow.setAttribute('class', 'cluster-link');
    parent.appendChild(arrow);
  }
  
  private createSCurve(parent: SVGElement, x1: number, y1: number, x2: number, y2: number) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const controlX1 = x1 + this.horizontalSpacing * 0.5;
    const controlY1 = y1;
    const controlX2 = x2 - this.horizontalSpacing * 0.5;
    const controlY2 = y2;
    
    path.setAttribute('d', `M ${x1 + this.nodeRadius} ${y1} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${x2 - this.nodeRadius} ${y2}`);
    path.setAttribute('stroke', this.linkStyles.stroke);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', this.linkStyles.strokeWidth);
    path.setAttribute('marker-end', 'url(#arrowhead)');
    path.setAttribute('class', 'cluster-link');
    parent.appendChild(path);
  }
  
  private isCoinbase(tx: Transaction): boolean {
    return tx.vin.some(input => input.is_coinbase);
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

  // Add a method to add transactions to the displayed list
  public addTransaction(transaction: Transaction): void {
    if (!this.displayedTransactions.some(tx => tx.txid === transaction.txid)) {
      this.displayedTransactions.push(transaction);
      this.renderTransactionFlow();
    }
  }
  
  // Add method to fetch the next transaction
  private fetchNextTransaction(txid: string, address: string): void {
    const currentTx = this.displayedTransactions.find(t => t.txid === txid);
    
    // Ensure we have the transaction and its outspends
    if (!currentTx || !currentTx._outspends) {
      console.log('Transaction or outspends not found');
      return;
    }

    const outspendIndex = currentTx.vout.findIndex(vout => vout.scriptpubkey_address === address || vout.scriptpubkey === getScriptPubKey(address))
    // Get the outspend for this specific output
    console.log('currentTx._outspends', currentTx._outspends);
    const outspend = currentTx._outspends[outspendIndex];//might be wrong
    if (!outspend.spent) {
      console.log('outspend not spent');
      return;
    }

    // Fetch the transaction that spent this specific output
    this.electrsApiService.getTransaction$(outspend.txid).subscribe(nextTx => {
      // Verify that the input of this transaction matches our expected vin
      const matchingInput = nextTx.vin.find(input => {
        console.log('input', input.prevout)
        return input.txid === currentTx.txid && (input.prevout.scriptpubkey_address === address || input.prevout.scriptpubkey === getScriptPubKey(address))
      });
      
      if (matchingInput) {
        // Fetch outspends for this new transaction before adding it
        this.electrsApiService.getOutspends$(nextTx.txid).subscribe(outspends => {
          // Store outspends with the transaction
          nextTx._outspends = outspends;
          
          // Now add the transaction with its outspends to our display list
          this.addTransaction(nextTx);
        });
      } else {
        console.log('Next transaction does not reference the expected input');
      }
    });
  }
}
function getScriptPubKey(address: string): string {
  return address.length === 66 ? '21' : '41' + address + 'ac'
}