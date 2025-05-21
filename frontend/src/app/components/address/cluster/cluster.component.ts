import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Transaction } from '@interfaces/electrs.interface';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { ClusterDrawService } from './cluster.draw';

// known satoshi address: http://localhost:4200/address/0411db93e1dcdb8a016b49840f8c53bc1eb68a382e97b1482ecad7b148a6909a5cb2e0eaddfb84ccf9744464f82e160bfa9b8b64f9d4c03f999b8643f656b412a3
// multiple inputs: http://localhost:4200/address/04ea1feff861b51fe3f5f8a3b12d0f4712db80e919548a80839fc47c6a21e66d957e9c5d8cd108c7a2d2324bad71f9904ac0ae7336507d785b17a2c115e427a32f
// multiple outputs: http://localhost:4200/address/1CGqByN5brkvpRrM58d7JXC4VnXb1H1j5d
// 2 inputs: http://localhost:4200/address/12ZYdSCw3dbWcXDqBeVpH2CWAWMVx1fmYt

// prev in external: http://localhost:4200/address/1AqtQTfkngLf7P7TPdXZkWAhs5cqN7t7Fw

export enum HeuristicType {
  cio,
  change,
  reused
}

// Add this interface near the top of the file
export interface TransactionObject {
  transaction: Transaction;
  clusterIndex: number;
  heuristics: HeuristicType[];
}

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
  @ViewChild('tooltip') tooltipElement: ElementRef;
  
  isLoading = true;
  
  private displayedTransactions: TransactionObject[] = [];
  private branches: string[] = [];
  private branchesArray: TransactionObject[][] = [];
  // SVG zoom and pan properties
  private scale = 0.8;
  private translateX = 0;
  private translateY = 0;
  
  // Computed transform property for SVG
  get transform(): string {
    return `translate(${this.translateX}, ${this.translateY}) scale(${this.scale})`;
  }
  
  // View box for SVG
  get viewBox(): string {
    const scaleFactor = 1.25;
    return `0 0 ${this.svgWidth * scaleFactor} ${this.svgHeight * scaleFactor}`;
  }

  // SVG dimensions
  private svgWidth = 800;
  private svgHeight = 500;

  constructor(
    private electrsApiService: ElectrsApiService,
    private clusterDrawService: ClusterDrawService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.transactions && this.transactions?.length) {
      this.isLoading = false;
      
      // Build a chain of connected transactions instead of just using the first one
      this.buildTransactionChain();
      
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
    
    const dimensions = this.clusterDrawService.renderTransactionFlow(
      this.clusterSvg,
      this.displayedTransactions,
      this.branches,
      this.branchesArray,
      this.addressString,
      (txid, address, backtracking, isBranch) => {
        if (backtracking) {
          if (isBranch) {
            this.fetchBranchPrevTransaction(txid, address);
          } else {
            this.fetchPrevTransaction(txid, address);
          }
        } else {
          this.fetchNextTransaction(txid, address);
        }
      },
      this.tooltipElement?.nativeElement
    );
    
    if (dimensions) {
      this.svgWidth = dimensions.width;
      this.svgHeight = dimensions.height;
    }
  }
  
  private initializeZoom() {
    if (this.svgContainer) {
      this.clusterDrawService.initializeZoom(
        this.svgContainer,
        (scale, translateX, translateY) => {
          this.scale = scale;
          this.translateX = translateX;
          this.translateY = translateY;
        },
        this.scale,
        this.translateX,
        this.translateY
      );
    }
  }

  // New method to find the most likely change output index
  private findChangeOutputIndex(tx: Transaction): number {
    // First check if any output spends back to the input address
    // as is this only applies to the origninal address, should check for spend to any address in cluster.
    for (let i = 0; i < tx.vout.length; i++) {
      const output = tx.vout[i];
      if (output.scriptpubkey_address === this.addressString || 
          output.scriptpubkey === getScriptPubKey(this.addressString)) {
        return i;
      }
    }
    
    // If no direct match, assume the last output is change (common Bitcoin convention)
    return tx.vout.length - 1;
  }

  // Update the addTransaction method to use TransactionObject
  public addTransaction(transaction: Transaction): void {
    if (!this.displayedTransactions.some(txObj => txObj.transaction.txid === transaction.txid)) {
      const clusterIndex = this.findChangeOutputIndex(transaction);
      this.displayedTransactions.push({
        transaction: transaction,
        clusterIndex: clusterIndex,
        heuristics: this.getHeuristics(transaction)
      });
      this.renderTransactionFlow();
    }
  }

  public prependTransaction(transaction: Transaction, clusterIndex: number): void {
    this.displayedTransactions.unshift({
      transaction: transaction,
      clusterIndex: clusterIndex,
      heuristics: this.getHeuristics(transaction)
    });
    this.renderTransactionFlow();
  }

  private prependBranchTransaction(transaction: Transaction, branchIndex: number, clusterIndex: number): void {
    this.branchesArray[branchIndex].unshift({
      transaction: transaction,
      clusterIndex: clusterIndex,
      heuristics: this.getHeuristics(transaction)
    });
    console.log('branchesArray', this.branchesArray);
    this.renderTransactionFlow();
  }
  
  // Update fetchNextTransaction to use TransactionObject
  private fetchNextTransaction(txid: string, address: string): void {
    console.log('fetchNextTransaction', address);
    
    // Use the generalized method to get the next transaction ID
    const nextTxid = this.clusterDrawService.getConnectedTransactionId(txid, address, false);
    if (!nextTxid) {
      console.error('No next transaction found for:', txid);
      return;
    }

    // Fetch the transaction that spent this specific output
    this.electrsApiService.getTransaction$(nextTxid).subscribe(nextTx => {
      // Verify that the input of this transaction matches our expected vin
      const currentTxObj = this.displayedTransactions.find(t => t.transaction.txid === txid);
      if (!currentTxObj) {
        console.error('Current transaction not found:', txid);
        return;
      }
      
      const outputIndex = currentTxObj.clusterIndex;
      const matchingInput = nextTx.vin.find(input => {
        return input.txid === txid && input.vout === outputIndex;
      });
      
      if (matchingInput) {
        console.log('Found matching input:', matchingInput);
        // Fetch outspends for this new transaction before adding it
        this.electrsApiService.getOutspends$(nextTx.txid).subscribe(outspends => {
          // Store outspends with the transaction
          nextTx._outspends = outspends;
          
          // create new branch if addl input in cluster
          if (nextTx.vin.length == 2) {
            for (let i = 0; i < nextTx.vin.length; i++) {
              const output = nextTx.vin[i].prevout;
              const inputAddress = this.getAddressFromOutput(output);
              if (inputAddress !== address) {
                this.branches.push(inputAddress);
                this.branchesArray.push([]);
              }
            }
          }

          // Now add the transaction with its outspends to our display list
          this.addTransaction(nextTx);
        });
      } else {
        console.log('Next transaction does not reference the expected input');
      }
    });
  }

  private fetchPrevTransaction(txid: string, address: string): void {
    // Use the generalized method to get the previous transaction ID
    const prevTxid = this.clusterDrawService.getConnectedTransactionId(txid, address, true);
    if (!prevTxid) {
      console.error('No previous transaction found for:', txid);
      return;
    }
    
    console.log('Fetching previous transaction:', prevTxid);

    this.electrsApiService.getTransaction$(prevTxid).subscribe(prevTx => {
      // find clusterIndex - the output that matches our address
      const clusterIndex = prevTx.vout.findIndex(vout => {
        return address === this.getAddressFromOutput(vout);
      });
      
      if (clusterIndex === -1) {
        console.error('Could not find output matching address:', address);
        return;
      }
      
      this.electrsApiService.getOutspends$(prevTx.txid).subscribe(outspends => {
        prevTx._outspends = outspends;
        this.prependTransaction(prevTx, clusterIndex);  
      });
    });
  }

  private fetchBranchPrevTransaction(txid: string, address: string): void {
    // Use the generalized method to get the previous transaction ID
    const prevTxid = this.clusterDrawService.getConnectedTransactionId(txid, address, true);
    if (!prevTxid) {
      console.error('No previous transaction found for branch:', txid);
      return;
    }
    
    console.log('Fetching branch previous transaction:', prevTxid);

    this.electrsApiService.getTransaction$(prevTxid).subscribe(prevTx => {
      // find branch index
      const branchIndex = this.branches.indexOf(address);
      if (branchIndex === -1) {
        console.error('Branch not found for address:', address);
        return;
      }
      
      // find clusterIndex - the output that matches our branch address
      const clusterIndex = prevTx.vout.findIndex(vout => {
        return address === this.getAddressFromOutput(vout);
      });
      
      if (clusterIndex === -1) {
        console.error('Could not find output matching branch address:', address);
        return;
      }
      
      this.electrsApiService.getOutspends$(prevTx.txid).subscribe(outspends => {
        prevTx._outspends = outspends;
        this.prependBranchTransaction(prevTx, branchIndex, clusterIndex);  
      });
    });
  }

  private getHeuristics(tx: Transaction): HeuristicType[] {
    const heuristics: HeuristicType[] = [HeuristicType.change];
    // if multiple inputs, apply cio
    if (tx.vin.length > 1) {
      heuristics.push(HeuristicType.cio);
    }
    // if reused, apply reused
    for (let i = 0; i < tx.vout.length; i++) {
      const output = tx.vout[i];
      if (output.scriptpubkey_address === this.addressString || 
          output.scriptpubkey === getScriptPubKey(this.addressString)) {
        heuristics.push(HeuristicType.reused);
      }
    }
    return heuristics;
  }
  
  // Helper method needed by component
  private getAddressFromOutput(output): string {
    return output.scriptpubkey_address || output.scriptpubkey;
  }

  // New method to build a chain of connected transactions
  private buildTransactionChain(): void {
    // Clear any existing transactions
    this.displayedTransactions = [];
    this.branches = [];
    this.branchesArray = [];
    
    // Create a map of txid -> transaction for quick lookups
    const txMap = new Map<string, Transaction>();
    this.transactions.forEach(tx => txMap.set(tx.txid, tx));
    
    // Start with the oldest transaction
    let currentTx = this.transactions[this.transactions.length - 1]; // Get the oldest transaction
    
    // Track processed transactions to avoid cycles
    const processedTxids = new Set<string>();
    
    // Add a small delay to ensure _outspends is available
    while (currentTx && !processedTxids.has(currentTx.txid)) {
      processedTxids.add(currentTx.txid);
      
      // Find the change output index
      const clusterIndex = this.findChangeOutputIndex(currentTx);
      
      // Add to displayed transactions
      this.displayedTransactions.push({
        transaction: currentTx,
        clusterIndex: clusterIndex,
        heuristics: this.getHeuristics(currentTx)
      });
      
      // Check for potential branches in this transaction
      this.checkForBranches(currentTx);
      console.log('branches', this.branches,this.branchesArray);
      // Check if this transaction's output is spent by another transaction in our list
      if (currentTx._outspends && 
          currentTx._outspends[clusterIndex] && 
          currentTx._outspends[clusterIndex].txid && 
          txMap.has(currentTx._outspends[clusterIndex].txid)) {
        // Move to the next transaction in the chain
        currentTx = txMap.get(currentTx._outspends[clusterIndex].txid);
      } else {
        // No more connected transactions in our list
        break;
      }
    }
    
    console.log(`Built transaction chain with ${this.displayedTransactions.length} connected transactions`);
    console.log(`Found ${this.branches.length} potential branches`);
    this.renderTransactionFlow();
  }

  // Helper method to check for potential branches in a transaction
  private checkForBranches(tx: Transaction): void {
    // Check if transaction has multiple inputs (potential branch)
    if (tx.vin.length >= 2) {
      // For the first transaction in our chain, we need to identify which input
      // corresponds to our main address flow and which should be branches
      
      // First, check if any input directly matches our address string
      let mainInputIndex = tx.vin.findIndex(input => {
        const inputAddress = this.getAddressFromOutput(input.prevout);
        return inputAddress === this.addressString;
      });
      
      // If no direct match was found, assume the first input is the main one
      // This matches the logic in cluster.draw.ts
      if (mainInputIndex === -1) {
        mainInputIndex = 0;
      }
      
      // Create branches for all other inputs
      for (let i = 0; i < tx.vin.length; i++) {
        // Skip the main input
        if (i === mainInputIndex) continue;
        
        const input = tx.vin[i];
        const output = input.prevout;
        const inputAddress = this.getAddressFromOutput(output);
        
        // Add as branch if not already included and not the original address
        if (inputAddress && !this.branches.includes(inputAddress)) {
          this.branches.push(inputAddress);
          this.branchesArray.push([]);
        }
      }
    }
  }
}

function getScriptPubKey(address: string): string {
  return address.length === 66 ? '21' : '41' + address + 'ac'
}