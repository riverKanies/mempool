import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Transaction } from '@interfaces/electrs.interface';

@Component({
  selector: 'app-address-cluster',
  templateUrl: './cluster.component.html',
  styleUrls: ['./cluster.component.scss']
})
export class ClusterComponent implements OnChanges {
  @Input() transactions: Transaction[];
  @Input() addressString: string;
  
  firstTransaction: Transaction | null = null;
  isLoading = true;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.transactions && this.transactions?.length) {
      this.isLoading = false;
      this.firstTransaction = this.transactions[0];
    }
  }
} 